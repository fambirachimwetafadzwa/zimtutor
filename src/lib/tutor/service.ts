import { secretFromKey } from "../ai/guards";
import { screenLearnerMessage, type Helpline } from "../ai/safety";
import type { LearnerAnswer } from "../marking/spec";
import {
  STATE_LABELS,
  applyObservation,
  deriveState,
  displayMastery,
  markIntroduced,
  newMasteryRecord,
  type Difficulty,
  type MasteryRecord,
} from "../mastery/engine";
import { MISCONCEPTIONS } from "../misconceptions/registry";
import { checkAnswer } from "../questions/answer";
import { pickQuestion, type BankStore, type PickedQuestion } from "../questions/bank";
import {
  toPublicQuestion,
  toQuestionKey,
  type PublicQuestion,
  type QuestionKey,
} from "../questions/bank-rows";
import { eligibleTemplates } from "../questions/generate";
import { ALL_TEMPLATES } from "../questions/templates";
import type { ObjectiveInfo } from "../questions/types";
import type { TutorAction } from "./actions";
import { answerAsText, answerForStorage, describeLearnerAnswer } from "./answers";
import {
  MESSAGE_KIND,
  type MisconceptionFacts,
  type ObjectiveFacts,
  type TransitionDecision,
  type TutorMove,
} from "./moves";
import {
  POLICY,
  applySubmission,
  chooseTransition,
  classifyIntent,
  endsSession,
  mayRevealAnswer,
  type SubmissionOutcome,
} from "./policy";
import {
  newSessionState,
  type LessonMode,
  type OpenQuestion,
  type Phase,
  type SessionState,
  type SessionSummary,
} from "./state";
import {
  ActiveSessionExistsError,
  StepConflictError,
  type MasteryCommit,
  type MessageMeta,
  type NewAttempt,
  type NewMessage,
  type SessionRow,
  type SessionStatus,
  type StepCommit,
  type StoredMessage,
  type TutorStore,
} from "./store";
import { NOTICES } from "./template-voice";
import type { TutorActionName } from "./actions";
import type { MessageView, TutorView } from "./view";
import type { TutorVoice } from "./voice";

/**
 * The tutor. One lesson step at a time, in the order the specification gives:
 *
 *   identify the objective → introduce → explain → worked example → the learner tries a question →
 *   evaluate (deterministic marking) → identify the misconception → hint → another attempt →
 *   explain the correction → another question of suitable difficulty → update mastery (deterministic)
 *   → continue, review or advance.
 *
 * Every decision here is made by code from counters and marked outcomes. The words a child reads come
 * from a `TutorVoice` (plain template text, or a model's rephrasing that passed the guards); the voice
 * never chooses what happens next. Each step is committed to the store in one transaction, so a
 * double-click or a crash cannot leave a half-applied step.
 */

export class TutorError extends Error {
  constructor(
    readonly code: "NOT_FOUND" | "FORBIDDEN" | "NOT_PRACTICABLE" | "CONFLICT",
    message: string,
  ) {
    super(message);
    this.name = "TutorError";
  }
}

/** The syllabus as the tutor needs it. The running app reads the database; tests use fixtures. */
export interface CurriculumPort {
  objective(id: string): Promise<ObjectiveInfo | null>;
  facts(id: string): Promise<ObjectiveFacts | null>;
}

/** Counts and ids only: never a child's words. Safe to send to analytics. */
export type TutorEvent =
  | { type: "session_started"; mode: LessonMode; objectiveId: string }
  | { type: "answer_marked"; outcome: SubmissionOutcome; questionType: string; difficulty: number }
  | { type: "hint_given"; number: number }
  | {
      type: "question_resolved";
      result: "CORRECT" | "INCORRECT";
      decision: TransitionDecision;
      stateBefore: string;
      stateAfter: string;
    }
  | { type: "message_screened"; categories: string[]; flagged: boolean }
  | { type: "session_ended"; by: SessionSummary["endedBy"] };

export interface TutorDeps {
  store: TutorStore;
  bank: BankStore;
  curriculum: CurriculumPort;
  voice: TutorVoice;
  /** Named in the reply to a worrying message; null names none. */
  helpline?: Helpline | null;
  now?: () => Date;
  /** A seed for choosing questions, for repeatable tests. */
  seed?: () => string;
  onEvent?: (event: TutorEvent) => void;
}

interface Ctx {
  deps: TutorDeps;
  session: SessionRow;
  objective: ObjectiveInfo;
  facts: ObjectiveFacts;
  now: Date;
}

/** Everything one lesson step will change, collected before it is committed. */
class Step {
  readonly messages: NewMessage[] = [];
  attempt: NewAttempt | undefined;
  mastery: MasteryCommit | undefined;
  summary: SessionSummary | undefined;
  state: SessionState;
  phase: Phase;
  status: SessionStatus;

  constructor(readonly session: SessionRow) {
    this.state = structuredClone(session.state);
    this.phase = session.phase;
    this.status = session.status;
  }

  toCommit(): StepCommit {
    return {
      sessionId: this.session.id,
      expectedRev: this.session.rev,
      phase: this.phase,
      state: this.state,
      status: this.status,
      messages: this.messages,
      ...(this.summary ? { summary: this.summary } : {}),
      ...(this.attempt ? { attempt: this.attempt } : {}),
      ...(this.mastery ? { mastery: this.mastery } : {}),
    };
  }
}

const clock = (deps: TutorDeps): Date => (deps.now ? deps.now() : new Date());

function emit(deps: TutorDeps, event: TutorEvent): void {
  try {
    deps.onEvent?.(event);
  } catch {
    // monitoring must never break a lesson
  }
}

// ── small helpers ───────────────────────────────────────────────────────────────────────────────

const citationOf = (facts: ObjectiveFacts): string =>
  facts.source.page !== null
    ? `${facts.source.title}, page ${facts.source.pageLabel ?? facts.source.page}`
    : facts.source.title;

function misconceptionFacts(tags: readonly string[]): MisconceptionFacts | undefined {
  for (const tag of tags) {
    const found = MISCONCEPTIONS.find((m) => m.code === tag);
    if (found) return { code: found.code, name: found.name, nudge: found.nudge };
  }
  return undefined;
}

/** Where to aim the next question: the engine's target, gentler for a foundation check, easiest at first. */
function targetDifficulty(mode: LessonMode, record: MasteryRecord | undefined): Difficulty {
  if (!record || record.attempts === 0) return 1;
  return (mode === "FOUNDATION" ? Math.min(record.difficulty, 2) : record.difficulty) as Difficulty;
}

function defaultMode(record: MasteryRecord | undefined, now: Date): LessonMode {
  if (!record) return "LEARN";
  const state = deriveState(record, now);
  if (state === "NOT_STARTED") return "LEARN";
  if (state === "MASTERED" || state === "REVIEW") return "REVIEW";
  return "PRACTISE";
}

async function speak(
  ctx: Ctx,
  step: Step,
  move: TutorMove,
  extra: { questionId?: string; meta?: MessageMeta } = {},
): Promise<void> {
  const said = await ctx.deps.voice.say(move);
  step.messages.push({
    role: "tutor",
    kind: MESSAGE_KIND[move.kind],
    content: said.text,
    questionId: extra.questionId ?? null,
    meta: {
      source: said.source,
      ...(said.model ? { model: said.model } : {}),
      ...(said.fallback ? { fallback: said.fallback } : {}),
      ...extra.meta,
    },
  });
}

/** A fixed line that is not a lesson move. */
function notice(step: Step, kind: string, text: string, meta: MessageMeta = {}): void {
  step.messages.push({ role: "tutor", kind, content: text, meta: { source: "template", ...meta } });
}

async function loadQuestion(
  deps: TutorDeps,
  id: string,
): Promise<{ key: QuestionKey; pub: PublicQuestion }> {
  const [row, stored] = await Promise.all([deps.bank.question(id), deps.bank.key(id)]);
  if (!row || !stored)
    throw new TutorError("NOT_FOUND", `Question ${id} is missing from the bank.`);
  return { key: toQuestionKey(row, stored), pub: toPublicQuestion(row) };
}

async function pick(
  ctx: Ctx,
  exclude: readonly string[],
  difficulty: Difficulty,
): Promise<PickedQuestion> {
  const seed = ctx.deps.seed?.();
  const base = {
    learnerId: ctx.session.learnerId,
    objective: ctx.objective,
    difficulty,
    ...(seed ? { seed } : {}),
  };
  try {
    return await pickQuestion(ctx.deps.bank, { ...base, exclude });
  } catch {
    // Some goals have only a few different questions at a level: better a repeat than no lesson.
    return await pickQuestion(ctx.deps.bank, base);
  }
}

// ── the moves of a lesson ───────────────────────────────────────────────────────────────────────

/** Set the next question. */
async function nextQuestion(
  ctx: Ctx,
  step: Step,
  options: { again: boolean; difficulty?: Difficulty },
): Promise<void> {
  const mastery = await ctx.deps.store.getMastery(ctx.session.learnerId, ctx.session.objectiveId);
  const difficulty = options.difficulty ?? targetDifficulty(step.state.mode, mastery?.record);
  const picked = await pick(ctx, step.state.seen, difficulty);
  const { key } = await loadQuestion(ctx.deps, picked.id);
  step.state.question = {
    id: picked.id,
    shownAt: ctx.now.toISOString(),
    difficulty,
    hintCount: key.hints.length,
    submissions: 0,
    wrongAttempts: 0,
    almost: 0,
    hintsUsed: 0,
    tags: [],
  };
  step.state.seen = [...step.state.seen, picked.id];
  step.phase = "AWAITING_ANSWER";
  await speak(
    ctx,
    step,
    {
      kind: "ASK",
      objective: ctx.facts,
      number: step.state.resolved + 1,
      difficulty,
      again: options.again,
    },
    { questionId: picked.id },
  );
}

/** The explanation and a worked example. Also marks the goal as introduced. */
async function explain(ctx: Ctx, step: Step): Promise<void> {
  const { deps, facts, session } = ctx;
  const quotes = [
    { label: "What the syllabus says this goal covers", items: [...facts.content] },
    ...(facts.activities.length > 0
      ? [{ label: "Activities the syllabus suggests", items: [...facts.activities] }]
      : []),
  ].filter((q) => q.items.length > 0);
  await speak(
    ctx,
    step,
    { kind: "EXPLAIN", objective: facts },
    {
      meta: { quotes, citation: citationOf(facts) },
    },
  );

  const existing = await deps.store.getMastery(session.learnerId, session.objectiveId);
  const difficulty = Math.min(2, targetDifficulty(step.state.mode, existing?.record)) as Difficulty;
  const picked = await pick(ctx, step.state.seen, difficulty);
  const { key, pub } = await loadQuestion(deps, picked.id);
  step.state.seen = [...step.state.seen, picked.id];
  step.state.exampleQuestionId = picked.id;
  await speak(
    ctx,
    step,
    {
      kind: "WORKED_EXAMPLE",
      objective: facts,
      example: {
        stem: pub.stem,
        steps: key.solutionSteps,
        explanation: key.explanation,
        answer: answerAsText(key, pub),
      },
    },
    { questionId: picked.id },
  );

  const base = existing?.record ?? newMasteryRecord(ctx.now);
  const introduced = markIntroduced(base, ctx.now);
  if (introduced !== base)
    step.mastery = {
      objectiveId: session.objectiveId,
      expectedVersion: existing?.version ?? null,
      record: introduced,
    };
}

async function giveHint(ctx: Ctx, step: Step): Promise<void> {
  const q = step.state.question;
  if (!q) return;
  if (q.hintsUsed >= q.hintCount) {
    notice(step, "HINT", mayRevealAnswer(q) ? NOTICES.noMoreHints : NOTICES.noMoreHintsMustTry, {
      hint: { number: q.hintCount, of: q.hintCount, exhausted: true },
    });
    return;
  }
  const { key, pub } = await loadQuestion(ctx.deps, q.id);
  const hint = key.hints[q.hintsUsed];
  if (hint === undefined) return;
  await speak(
    ctx,
    step,
    {
      kind: "HINT",
      objective: ctx.facts,
      stem: pub.stem,
      hint,
      number: q.hintsUsed + 1,
      of: key.hints.length,
      secret: secretFromKey({ spec: key.spec, display: key.display }, pub.options),
    },
    { meta: { hint: { number: q.hintsUsed + 1, of: key.hints.length } }, questionId: q.id },
  );
  q.hintsUsed += 1;
  emit(ctx.deps, { type: "hint_given", number: q.hintsUsed });
}

/** The child asks to be shown the answer. Not before a try; a hint comes first. */
async function reveal(ctx: Ctx, step: Step): Promise<void> {
  const q = step.state.question;
  if (!q) return;
  if (!mayRevealAnswer(q)) {
    if (q.hintsUsed < q.hintCount) {
      notice(step, "FEEDBACK", NOTICES.hintFirst);
      await giveHint(ctx, step);
    } else {
      notice(step, "FEEDBACK", NOTICES.tryFirst);
    }
    return;
  }
  const { key, pub } = await loadQuestion(ctx.deps, q.id);
  await resolve(ctx, step, { key, pub, question: q, result: "INCORRECT", reason: "LEARNER_ASKED" });
}

async function skip(ctx: Ctx, step: Step): Promise<void> {
  const q = step.state.question;
  if (!q) return;
  if (step.state.skips >= POLICY.skipsPerSession) {
    notice(step, "FEEDBACK", NOTICES.skipLimit);
    return;
  }
  step.state.skips += 1;
  step.state.question = null;
  await nextQuestion(ctx, step, { again: true, difficulty: q.difficulty as Difficulty });
}

/** A question is resolved: it was answered right, or worked through with the child. Update mastery. */
async function resolve(
  ctx: Ctx,
  step: Step,
  args: {
    key: QuestionKey;
    pub: PublicQuestion;
    question: OpenQuestion;
    result: "CORRECT" | "INCORRECT";
    reason?: "TRIES_USED" | "LEARNER_ASKED";
  },
): Promise<void> {
  const { deps, session, facts, now } = ctx;
  const { key, pub, question, result } = args;
  const existing = await deps.store.getMastery(session.learnerId, session.objectiveId);
  const before = existing?.record ?? newMasteryRecord(now);
  const { record, event } = applyObservation(before, {
    outcome: result,
    difficulty: question.difficulty as Difficulty,
    hintsUsed: question.hintsUsed,
    attemptNumber: Math.max(1, question.submissions),
    questionType: key.type,
    at: now,
  });
  step.mastery = {
    objectiveId: session.objectiveId,
    expectedVersion: existing?.version ?? null,
    record,
    event: { questionId: question.id, event },
  };

  const s = step.state;
  const firstTryRight =
    result === "CORRECT" && question.submissions === 1 && question.hintsUsed === 0;
  s.resolved += 1;
  s.firstTry += firstTryRight ? 1 : 0;
  s.wrongInARow = result === "CORRECT" ? 0 : s.wrongInARow + 1;
  s.hintsUsed += question.hintsUsed;
  s.question = null;

  if (result === "INCORRECT") {
    await speak(
      ctx,
      step,
      {
        kind: "CORRECTION",
        objective: facts,
        stem: pub.stem,
        explanation: key.explanation,
        steps: key.solutionSteps,
        answer: answerAsText(key, pub),
        ...(misconceptionFacts(question.tags)
          ? { misconception: misconceptionFacts(question.tags)! }
          : {}),
        reason: args.reason ?? "TRIES_USED",
      },
      { questionId: question.id },
    );
  }

  const decision = chooseTransition({
    mode: s.mode,
    resolved: s.resolved,
    wrongInARow: s.wrongInARow,
    stateBefore: event.stateBefore,
    stateAfter: event.stateAfter,
    lastWasCorrect: result === "CORRECT",
  });
  await speak(
    ctx,
    step,
    { kind: "TRANSITION", objective: facts, decision, resolved: s.resolved, firstTry: s.firstTry },
    { meta: { decision } },
  );
  emit(deps, {
    type: "question_resolved",
    result,
    decision,
    stateBefore: event.stateBefore,
    stateAfter: event.stateAfter,
  });
  if (endsSession(decision))
    await finish(ctx, step, decision === "MASTERED" ? "MASTERED" : "SESSION_DONE");
  else step.phase = "RESOLVED";
}

/** Close the sitting and write the parent-safe summary (counts and outcomes, no words). */
async function finish(ctx: Ctx, step: Step, endedBy: SessionSummary["endedBy"]): Promise<void> {
  const { deps, session, now } = ctx;
  const latest =
    step.mastery?.record ??
    (await deps.store.getMastery(session.learnerId, session.objectiveId))?.record;
  const s = step.state;
  step.phase = "ENDED";
  step.status = s.resolved > 0 ? "COMPLETED" : "ABANDONED";
  step.state.question = null;
  step.summary = {
    objectiveId: session.objectiveId,
    mode: s.mode,
    questions: s.resolved,
    firstTry: s.firstTry,
    hintsUsed: s.hintsUsed,
    minutes: Math.round(((now.getTime() - Date.parse(s.startedAt)) / 60_000) * 10) / 10,
    masteryStart: s.masteryStart,
    masteryEnd: latest ? { score: latest.masteryScore, state: deriveState(latest, now) } : null,
    endedBy,
  };
  emit(deps, { type: "session_ended", by: endedBy });
}

// ── actions ─────────────────────────────────────────────────────────────────────────────────────

type Handler<A extends TutorAction = TutorAction> = (
  ctx: Ctx,
  step: Step,
  action: A,
) => Promise<boolean>;

/** The child answers the open question. */
const answerHandler: Handler<Extract<TutorAction, { type: "ANSWER" }>> = async (
  ctx,
  step,
  action,
) => {
  const open = step.state.question;
  if (step.phase !== "AWAITING_ANSWER" || !open || open.id !== action.questionId) return false;

  const { key, pub } = await loadQuestion(ctx.deps, open.id);
  const checked = checkAnswer(key, action.answer as LearnerAnswer);
  const { question, outcome } = applySubmission(open, checked.result.status, checked.tags);
  emit(ctx.deps, {
    type: "answer_marked",
    outcome,
    questionType: key.type,
    difficulty: open.difficulty,
  });

  const shown = describeLearnerAnswer(action.answer as LearnerAnswer, pub);
  if (shown.trim() !== "")
    step.messages.push({
      role: "learner",
      kind: "LEARNER_ANSWER",
      content: shown,
      questionId: open.id,
    });

  if (outcome === "UNMARKABLE") {
    // A question the machine cannot mark is set aside, never held against the child.
    notice(step, "FEEDBACK", NOTICES.unmarkable);
    step.state.question = null;
    await nextQuestion(ctx, step, { again: true, difficulty: open.difficulty as Difficulty });
    return true;
  }

  const secret = secretFromKey({ spec: key.spec, display: key.display }, pub.options);
  const feedback = (verdict: "INCORRECT" | "ALMOST" | "UNREADABLE" | "CORRECT"): TutorMove => {
    const misconception = misconceptionFacts(checked.tags);
    return {
      kind: "FEEDBACK",
      objective: ctx.facts,
      stem: pub.stem,
      verdict,
      signals: checked.result.signals,
      attempt: Math.max(1, question.submissions),
      attemptsLeft: Math.max(0, POLICY.maxWrongAttempts - question.wrongAttempts),
      hintsUsed: question.hintsUsed,
      ...(misconception && verdict === "INCORRECT" ? { misconception } : {}),
      ...(verdict === "CORRECT" ? {} : { secret }),
      variety: open.id,
    };
  };

  if (outcome === "UNREADABLE") {
    await speak(ctx, step, feedback("UNREADABLE"), { meta: { verdict: "UNREADABLE" } });
    return true;
  }

  // Marked: this try is recorded whatever the verdict.
  step.attempt = attemptRow(ctx, question, key, action.answer as LearnerAnswer, checked);

  if (outcome === "CORRECT") {
    await speak(ctx, step, feedback("CORRECT"), {
      meta: { verdict: "CORRECT", attempt: question.submissions },
    });
    await resolve(ctx, step, { key, pub, question, result: "CORRECT" });
    return true;
  }
  if (outcome === "EXHAUSTED") {
    await resolve(ctx, step, { key, pub, question, result: "INCORRECT", reason: "TRIES_USED" });
    return true;
  }

  // WRONG or ALMOST: the child tries again.
  step.state.question = question;
  await speak(ctx, step, feedback(outcome === "ALMOST" ? "ALMOST" : "INCORRECT"), {
    meta: { verdict: outcome, attempt: question.submissions },
  });
  return true;
};

function attemptRow(
  ctx: Ctx,
  question: OpenQuestion,
  key: QuestionKey,
  answer: LearnerAnswer,
  checked: ReturnType<typeof checkAnswer>,
): NewAttempt {
  const elapsed = ctx.now.getTime() - Date.parse(question.shownAt);
  const { result } = checked;
  return {
    questionId: question.id,
    objectiveId: ctx.session.objectiveId,
    attemptNumber: question.submissions,
    answer: answerForStorage(answer),
    isCorrect: result.status === "CORRECT",
    score: Math.round(result.score * 1000) / 1000,
    hintsUsed: question.hintsUsed,
    markingMethod: key.spec.method,
    markingDetail: {
      status: result.status,
      signals: result.signals,
      ...result.detail,
      ...(result.parts
        ? {
            parts: Object.fromEntries(
              Object.entries(result.parts).map(([id, r]) => [id, r.status]),
            ),
          }
        : {}),
    },
    misconceptionTags: checked.tags,
    timeTakenMs: Number.isFinite(elapsed)
      ? Math.min(Math.max(0, Math.round(elapsed)), 3_600_000)
      : null,
    difficulty: question.difficulty,
  };
}

const handlers: { [K in TutorActionName]: Handler<Extract<TutorAction, { type: K }>> } = {
  CONTINUE: async (ctx, step) => {
    if (step.phase !== "LESSON") return false;
    if (step.state.page <= 1) {
      await explain(ctx, step);
      step.state.page = 2;
    } else {
      await nextQuestion(ctx, step, { again: false });
    }
    return true;
  },

  SKIP_LESSON: async (ctx, step) => {
    if (step.phase !== "LESSON") return false;
    step.state.page = 2;
    await nextQuestion(ctx, step, { again: false });
    return true;
  },

  ANSWER: answerHandler,

  HINT: async (ctx, step) => {
    if (step.phase !== "AWAITING_ANSWER" || !step.state.question) return false;
    await giveHint(ctx, step);
    return true;
  },

  SHOW_ANSWER: async (ctx, step) => {
    if (step.phase !== "AWAITING_ANSWER" || !step.state.question) return false;
    await reveal(ctx, step);
    return true;
  },

  NEXT_QUESTION: async (ctx, step) => {
    if (step.phase !== "RESOLVED") return false;
    await nextQuestion(ctx, step, { again: false });
    return true;
  },

  SKIP_QUESTION: async (ctx, step) => {
    if (step.phase !== "AWAITING_ANSWER" || !step.state.question) return false;
    await skip(ctx, step);
    return true;
  },

  EXPLAIN_AGAIN: async (ctx, step) => {
    if (step.phase === "ENDED") return false;
    await explain(ctx, step);
    return true;
  },

  ASK: async (ctx, step, action) => {
    const screen = screenLearnerMessage(action.text, {
      helpline: ctx.deps.helpline === undefined ? undefined : ctx.deps.helpline,
    });
    if (!screen.clean) {
      emit(ctx.deps, {
        type: "message_screened",
        categories: screen.categories,
        flagged: screen.flag,
      });
      if (!screen.categories.includes("EMPTY"))
        step.messages.push({
          role: "learner",
          kind: "LEARNER_MESSAGE",
          content: screen.stored,
          flagged: screen.flag,
          meta: { screen: screen.categories },
        });
      notice(step, "SAFETY", screen.reply ?? NOTICES.nothingToDo, { screen: screen.categories });
      return true;
    }

    step.messages.push({ role: "learner", kind: "LEARNER_MESSAGE", content: screen.text });
    const open = step.state.question;
    switch (classifyIntent(screen.text)) {
      case "HINT":
        if (step.phase === "AWAITING_ANSWER" && open) return (await giveHint(ctx, step), true);
        break;
      case "SHOW_ANSWER":
        if (step.phase === "AWAITING_ANSWER" && open) return (await reveal(ctx, step), true);
        break;
      case "SKIP":
        if (step.phase === "AWAITING_ANSWER" && open) return (await skip(ctx, step), true);
        if (step.phase === "RESOLVED")
          return (await nextQuestion(ctx, step, { again: false }), true);
        break;
      case "EXPLAIN_AGAIN":
        return (await explain(ctx, step), true);
      case "STOP":
        await endNow(ctx, step);
        return true;
      default:
        break;
    }

    // A real question for the tutor. The voice answers inside the guards; the open question's answer
    // stays out of reach of the model and of the reply.
    const secret = open
      ? await loadQuestion(ctx.deps, open.id).then(({ key, pub }) => ({
          stem: pub.stem,
          secret: secretFromKey({ spec: key.spec, display: key.display }, pub.options),
        }))
      : undefined;
    await speak(ctx, step, {
      kind: "ANSWER_QUESTION",
      objective: ctx.facts,
      learnerMessage: screen.text,
      ...(secret ?? {}),
    });
    return true;
  },

  END: async (ctx, step) => {
    if (step.phase === "ENDED") return false;
    await endNow(ctx, step);
    return true;
  },
};

async function endNow(ctx: Ctx, step: Step): Promise<void> {
  await speak(ctx, step, {
    kind: "TRANSITION",
    objective: ctx.facts,
    decision: "STOPPED",
    resolved: step.state.resolved,
    firstTry: step.state.firstTry,
  });
  await finish(ctx, step, "LEARNER");
}

// ── entry points ────────────────────────────────────────────────────────────────────────────────

async function contextFor(deps: TutorDeps, session: SessionRow): Promise<Ctx> {
  const [objective, facts] = await Promise.all([
    deps.curriculum.objective(session.objectiveId),
    deps.curriculum.facts(session.objectiveId),
  ]);
  if (!objective || !facts)
    throw new TutorError("NOT_FOUND", `The goal ${session.objectiveId} is not in the syllabus.`);
  return { deps, session, objective, facts, now: clock(deps) };
}

async function ownedSession(
  deps: TutorDeps,
  learnerId: string,
  sessionId: string,
): Promise<SessionRow> {
  const session = await deps.store.getSession(sessionId);
  if (!session) throw new TutorError("NOT_FOUND", "That lesson does not exist.");
  if (session.learnerId !== learnerId)
    throw new TutorError("FORBIDDEN", "That lesson belongs to someone else.");
  return session;
}

/**
 * Open a lesson on a goal, or return the one already open. A lesson left alone for a couple of hours
 * is closed and a fresh one begins.
 */
export async function startOrResume(
  deps: TutorDeps,
  input: {
    learnerId: string;
    objectiveId: string;
    mode?: LessonMode;
    /** FOUNDATION: the goal this check is for. */
    forObjectiveId?: string;
  },
): Promise<TutorView> {
  const now = clock(deps);
  const [objective, facts] = await Promise.all([
    deps.curriculum.objective(input.objectiveId),
    deps.curriculum.facts(input.objectiveId),
  ]);
  if (!objective || !facts)
    throw new TutorError("NOT_FOUND", `The goal ${input.objectiveId} is not in the syllabus.`);
  if (eligibleTemplates(ALL_TEMPLATES, objective).length === 0)
    throw new TutorError(
      "NOT_PRACTICABLE",
      "This goal is done with real materials, so ZimTutor has no questions for it.",
    );

  const existing = await deps.store.findActiveSession(input.learnerId, input.objectiveId);
  if (existing) {
    const idleMs = now.getTime() - Date.parse(existing.lastActivityAt);
    if (idleMs <= POLICY.idleMinutes * 60_000) return buildView(deps, existing);
    await closeIdle(deps, existing, now);
  }

  const mastery = await deps.store.getMastery(input.learnerId, input.objectiveId);
  const mode = input.mode ?? defaultMode(mastery?.record, now);
  const state = newSessionState({
    mode,
    forObjectiveId: input.forObjectiveId,
    now,
    masteryStart: mastery
      ? { score: mastery.record.masteryScore, state: deriveState(mastery.record, now) }
      : null,
  });

  let session: SessionRow;
  try {
    session = await deps.store.createSession({
      learnerId: input.learnerId,
      objectiveId: input.objectiveId,
      phase: "IDENTIFY_OBJECTIVE",
      state,
    });
  } catch (error) {
    if (error instanceof ActiveSessionExistsError) {
      // a double click: the other request won
      const winner = await deps.store.findActiveSession(input.learnerId, input.objectiveId);
      if (winner) return buildView(deps, winner);
    }
    throw error;
  }

  const ctx: Ctx = { deps, session, objective, facts, now };
  const step = new Step(session);
  const becauseOf = input.forObjectiveId
    ? (await deps.curriculum.facts(input.forObjectiveId))?.text
    : undefined;
  await speak(
    ctx,
    step,
    { kind: "IDENTIFY", objective: facts, mode, ...(becauseOf ? { becauseOf } : {}) },
    {
      meta: {
        quotes: [{ label: "The goal, word for word from the syllabus", items: [facts.text] }],
        citation: citationOf(facts),
      },
    },
  );
  if (mode === "LEARN") {
    await speak(ctx, step, { kind: "INTRODUCE", objective: facts });
    step.state.page = 1;
    step.phase = "LESSON";
  } else {
    step.state.page = 2;
    await nextQuestion(ctx, step, { again: false });
  }
  await deps.store.commit(step.toCommit());
  emit(deps, { type: "session_started", mode, objectiveId: input.objectiveId });
  return buildView(deps, (await deps.store.getSession(session.id)) ?? session);
}

async function closeIdle(deps: TutorDeps, session: SessionRow, now: Date): Promise<void> {
  const step = new Step(session);
  const objective = await deps.curriculum.objective(session.objectiveId);
  const facts = await deps.curriculum.facts(session.objectiveId);
  if (!objective || !facts) return;
  await finish({ deps, session, objective, facts, now }, step, "IDLE");
  try {
    await deps.store.commit(step.toCommit());
  } catch (error) {
    if (!(error instanceof StepConflictError)) throw error; // someone just used it: leave it alone
  }
}

/** Do one thing in a lesson. A repeated or stale request (a double click) changes nothing. */
export async function act(
  deps: TutorDeps,
  input: { learnerId: string; sessionId: string; action: TutorAction },
): Promise<TutorView> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const session = await ownedSession(deps, input.learnerId, input.sessionId);
    if (session.status !== "ACTIVE") return buildView(deps, session);
    const ctx = await contextFor(deps, session);
    const step = new Step(session);
    const handler = handlers[input.action.type] as Handler;
    const changed = await handler(ctx, step, input.action);
    if (!changed) return buildView(deps, session);
    try {
      await deps.store.commit(step.toCommit());
    } catch (error) {
      if (error instanceof StepConflictError) continue; // read the session again and decide afresh
      throw error;
    }
    const fresh = await deps.store.getSession(session.id);
    return buildView(deps, fresh ?? session);
  }
  throw new TutorError("CONFLICT", "The lesson kept changing; please try again.");
}

/** The lesson as the learner's screen shows it. */
export async function viewSession(
  deps: TutorDeps,
  input: { learnerId: string; sessionId: string },
): Promise<TutorView> {
  return buildView(deps, await ownedSession(deps, input.learnerId, input.sessionId));
}

// ── the view ────────────────────────────────────────────────────────────────────────────────────

function actionsFor(session: SessionRow): TutorActionName[] {
  if (session.status !== "ACTIVE") return [];
  const s = session.state;
  switch (session.phase) {
    case "LESSON":
      return ["CONTINUE", "SKIP_LESSON", "ASK", "END"];
    case "AWAITING_ANSWER": {
      const q = s.question;
      const actions: TutorActionName[] = ["ANSWER"];
      if (q && q.hintsUsed < q.hintCount) actions.push("HINT");
      if (q && mayRevealAnswer(q)) actions.push("SHOW_ANSWER");
      if (s.skips < POLICY.skipsPerSession) actions.push("SKIP_QUESTION");
      actions.push("EXPLAIN_AGAIN", "ASK", "END");
      return actions;
    }
    case "RESOLVED":
      return ["NEXT_QUESTION", "EXPLAIN_AGAIN", "ASK", "END"];
    default:
      return [];
  }
}

function messageView(
  m: StoredMessage,
  questions: ReadonlyMap<string, PublicQuestion>,
): MessageView {
  const showsQuestion = m.kind === "QUESTION" || m.kind === "WORKED_EXAMPLE";
  return {
    id: m.id,
    role: m.role === "learner" ? "learner" : "tutor",
    kind: m.kind,
    text: m.content,
    at: m.createdAt,
    source: m.role === "learner" ? null : (m.meta.source ?? "template"),
    quotes: m.meta.quotes ?? [],
    citation: m.meta.citation ?? null,
    hint: m.meta.hint ? { number: m.meta.hint.number, of: m.meta.hint.of } : null,
    question: showsQuestion && m.questionId ? (questions.get(m.questionId) ?? null) : null,
    safety: m.kind === "SAFETY",
  };
}

export async function buildView(deps: TutorDeps, session: SessionRow): Promise<TutorView> {
  const [messages, facts, mastery] = await Promise.all([
    deps.store.listMessages(session.id),
    deps.curriculum.facts(session.objectiveId),
    deps.store.getMastery(session.learnerId, session.objectiveId),
  ]);
  if (!facts)
    throw new TutorError("NOT_FOUND", `The goal ${session.objectiveId} is not in the syllabus.`);

  const wanted = new Set<string>();
  for (const m of messages)
    if (m.questionId && (m.kind === "QUESTION" || m.kind === "WORKED_EXAMPLE"))
      wanted.add(m.questionId);
  const openId = session.state.question?.id;
  if (openId) wanted.add(openId);
  const rows = await Promise.all([...wanted].map((id) => deps.bank.question(id)));
  const questions = new Map<string, PublicQuestion>();
  for (const row of rows) if (row) questions.set(row.id, toPublicQuestion(row));

  const now = clock(deps);
  const s = session.state;
  const open = s.question;
  const limit =
    s.mode === "REVIEW"
      ? POLICY.reviewQuestions
      : s.mode === "FOUNDATION"
        ? POLICY.foundationQuestions
        : POLICY.questionsPerSession;
  return {
    sessionId: session.id,
    rev: session.rev,
    status: session.status,
    phase: session.phase,
    objective: {
      id: facts.id,
      text: facts.text,
      grade: facts.grade,
      topic: facts.topicName,
      subtopic: facts.subtopicName,
    },
    messages: messages.filter((m) => m.role !== "system").map((m) => messageView(m, questions)),
    openQuestion: open ? (questions.get(open.id) ?? null) : null,
    hintsLeft: open ? Math.max(0, open.hintCount - open.hintsUsed) : 0,
    tries: open ? { used: open.wrongAttempts, max: POLICY.maxWrongAttempts } : null,
    actions: actionsFor(session),
    progress: { resolved: s.resolved, firstTry: s.firstTry, limit },
    mastery: mastery
      ? {
          state: deriveState(mastery.record, now),
          label: STATE_LABELS[deriveState(mastery.record, now)],
          percent: Math.round(displayMastery(mastery.record) * 100),
        }
      : null,
  };
}

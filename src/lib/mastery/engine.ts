/**
 * THE MASTERY ENGINE — deterministic, explainable, and the ONLY place mastery is calculated.
 *
 * A language model may explain, hint and encourage. It never decides that a learner has mastered
 * an objective: that comes from this code, from marked outcomes, by the rules below.
 *
 * Model (Bayesian Knowledge Tracing, with soft evidence)
 *   P(L)   probability the learner has the skill — stored as mastery_score
 *   After each RESOLVED question the score is updated from the outcome:
 *      correct:   P(L|obs) = P(L)(1−slip) / ( P(L)(1−slip) + (1−P(L))·guess )
 *      incorrect: P(L|obs) = P(L)·slip    / ( P(L)·slip    + (1−P(L))(1−guess) )
 *   A correct answer that needed hints or retries counts for LESS than an independent one: the
 *   posterior is a blend of the "correct" and "incorrect" cases weighted by the evidence (1.0 for an
 *   independent correct answer … 0 for an incorrect one). Then the learner may have learned
 *   something from the attempt itself: P(L) += (1 − P(L))·LEARN.
 *   Guess depends on the question type (a 4-option multiple-choice answer is guessable; a number
 *   is not); slip grows with difficulty.
 *
 * States (mastery_state)
 *   NOT_STARTED  never seen          INTRODUCED   explained, nothing answered yet
 *   LEARNING     score < 0.30        PRACTICING   0.30 – 0.55        DEVELOPING   0.55 – 0.85
 *   MASTERED     score ≥ 0.85 AND the evidence gates below are met ("mastered" is earned, not guessed)
 *   REVIEW       was mastered, and the spaced-repetition interval has elapsed
 *
 * Properties (tested): scores stay in [0,1]; a correct outcome never lowers the score and an
 * incorrect one never raises it; the same inputs always give the same outputs.
 */

export const MASTERY_STATES = [
  "NOT_STARTED",
  "INTRODUCED",
  "LEARNING",
  "PRACTICING",
  "DEVELOPING",
  "MASTERED",
  "REVIEW",
] as const;
export type MasteryState = (typeof MASTERY_STATES)[number];

export type Difficulty = 1 | 2 | 3 | 4 | 5;

export interface MasteryRecord {
  masteryScore: number;
  attempts: number;
  correctAttempts: number;
  incorrectAttempts: number;
  /** Newest last; at most RECENT_WINDOW independent outcomes (true = correct without help). */
  recentOutcomes: boolean[];
  recentAccuracy: number | null;
  lastAttemptAt: Date | null;
  /** Target difficulty of the NEXT question. */
  difficulty: Difficulty;
  confidence: number;
  currentState: MasteryState;
  stateChangedAt: Date;
  firstSeenAt: Date;
  masteredAt: Date | null;
  /** Independent correct answers at difficulty ≥ HARD_DIFFICULTY (mastery cannot be earned on easy questions alone). */
  hardCorrect: number;
  /** How many successful spaced reviews have followed mastery (0 = none yet). */
  reviewStage: number;
}

/** What happened on one resolved question. */
export interface Observation {
  outcome: "CORRECT" | "INCORRECT";
  difficulty: Difficulty;
  hintsUsed: number;
  /** 1 = answered at the first try; 2 = right/wrong after one retry; … */
  attemptNumber: number;
  questionType: QuestionTypeForGuess;
  at: Date;
}

export type QuestionTypeForGuess =
  | "MULTIPLE_CHOICE"
  | "TRUE_FALSE"
  | "NUMERIC"
  | "SHORT_ANSWER"
  | "WORKED_CALCULATION"
  | "ORDERING"
  | "MATCHING"
  | "FILL_IN_THE_BLANK"
  | "WORD_PROBLEM"
  | "VISUAL_DIAGRAM"
  | "DATA_INTERPRETATION";

export interface MasteryEvent {
  evidence: number;
  scoreBefore: number;
  scoreAfter: number;
  stateBefore: MasteryState;
  stateAfter: MasteryState;
  reason: string;
}

// ── parameters (documented, named, easy to review) ───────────────────────────────────────────
export const PRIOR = 0.08;
export const LEARN = 0.08;
export const RECENT_WINDOW = 10;
export const HARD_DIFFICULTY = 3;

/** Chance of a correct answer by luck or pattern-copying. */
export const GUESS: Record<QuestionTypeForGuess, number> = {
  MULTIPLE_CHOICE: 0.3,
  TRUE_FALSE: 0.5,
  NUMERIC: 0.2,
  SHORT_ANSWER: 0.2,
  WORKED_CALCULATION: 0.15,
  ORDERING: 0.2,
  MATCHING: 0.2,
  FILL_IN_THE_BLANK: 0.2,
  WORD_PROBLEM: 0.2,
  VISUAL_DIAGRAM: 0.25,
  DATA_INTERPRETATION: 0.25,
};

export const slipFor = (difficulty: Difficulty) => 0.1 + 0.03 * (difficulty - 1);

export const THRESHOLDS = {
  learning: 0.3,
  practicing: 0.55,
  mastered: 0.85,
  unmaster: 0.7,
} as const;
export const MASTERY_GATES = {
  minAttempts: 4,
  minCorrect: 3,
  recentAccuracy: 0.8,
  recentWindow: 5,
  minHardCorrect: 2,
} as const;
/** Days after the last attempt before a MASTERED objective becomes due for review; grows with each success. */
export const REVIEW_INTERVAL_DAYS = [3, 7, 14, 30, 60] as const;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const round = (x: number, places = 4) => Math.round(x * 10 ** places) / 10 ** places;
const DAY_MS = 86_400_000;

export function newMasteryRecord(now: Date): MasteryRecord {
  return {
    masteryScore: 0,
    attempts: 0,
    correctAttempts: 0,
    incorrectAttempts: 0,
    recentOutcomes: [],
    recentAccuracy: null,
    lastAttemptAt: null,
    difficulty: 1,
    confidence: 0,
    currentState: "NOT_STARTED",
    stateChangedAt: now,
    firstSeenAt: now,
    masteredAt: null,
    hardCorrect: 0,
    reviewStage: 0,
  };
}

/** The learner was shown the objective's explanation (no answer yet). */
export function markIntroduced(record: MasteryRecord, now: Date): MasteryRecord {
  if (record.currentState !== "NOT_STARTED") return record;
  return { ...record, currentState: "INTRODUCED", stateChangedAt: now };
}

/** How much one resolved question counts as success: 1 = independent, lower with help, 0 = wrong. */
export function evidenceFor(
  obs: Pick<Observation, "outcome" | "hintsUsed" | "attemptNumber">,
): number {
  if (obs.outcome === "INCORRECT") return 0;
  const penalty = 0.25 * Math.max(0, obs.hintsUsed) + 0.2 * Math.max(0, obs.attemptNumber - 1);
  return round(Math.max(0.2, 1 - penalty), 3);
}

export function bktPosterior(prior: number, evidence: number, guess: number, slip: number): number {
  const correct = (prior * (1 - slip)) / (prior * (1 - slip) + (1 - prior) * guess);
  const incorrect = (prior * slip) / (prior * slip + (1 - prior) * (1 - guess));
  return evidence * correct + (1 - evidence) * incorrect;
}

function intervalDays(stage: number): number {
  return REVIEW_INTERVAL_DAYS[Math.min(stage, REVIEW_INTERVAL_DAYS.length - 1)]!;
}

export function reviewDueAt(record: MasteryRecord): Date | null {
  if (record.currentState !== "MASTERED" && record.currentState !== "REVIEW") return null;
  const since = record.lastAttemptAt ?? record.masteredAt;
  return since ? new Date(since.getTime() + intervalDays(record.reviewStage) * DAY_MS) : null;
}

/** Are the evidence gates for MASTERED met? */
export function masteryGatesMet(
  r: Pick<MasteryRecord, "attempts" | "correctAttempts" | "recentOutcomes" | "hardCorrect">,
): boolean {
  if (r.attempts < MASTERY_GATES.minAttempts || r.correctAttempts < MASTERY_GATES.minCorrect)
    return false;
  if (r.hardCorrect < MASTERY_GATES.minHardCorrect) return false;
  const recent = r.recentOutcomes.slice(-MASTERY_GATES.recentWindow);
  if (recent.length < Math.min(MASTERY_GATES.recentWindow, MASTERY_GATES.minAttempts)) return false;
  return recent.filter(Boolean).length / recent.length >= MASTERY_GATES.recentAccuracy;
}

function stateFor(r: MasteryRecord, previous: MasteryState): MasteryState {
  if (r.attempts === 0) return previous === "INTRODUCED" ? "INTRODUCED" : "NOT_STARTED";
  const wasMastered = previous === "MASTERED" || previous === "REVIEW";
  const lastTwoWrong =
    r.recentOutcomes.length >= 2 && !r.recentOutcomes.at(-1) && !r.recentOutcomes.at(-2);
  if (r.masteryScore >= THRESHOLDS.mastered && masteryGatesMet(r)) return "MASTERED";
  // Hysteresis: once mastered, a single slip does not demote; a real fall in the score does.
  if (wasMastered && r.masteryScore >= THRESHOLDS.unmaster && !lastTwoWrong) return "MASTERED";
  if (r.masteryScore >= THRESHOLDS.practicing) return "DEVELOPING";
  if (r.masteryScore >= THRESHOLDS.learning) return "PRACTICING";
  return "LEARNING";
}

/** The state to SHOW and plan with at `now`: MASTERED becomes REVIEW once its interval has passed. */
export function deriveState(record: MasteryRecord, now: Date): MasteryState {
  if (record.currentState === "MASTERED") {
    const due = reviewDueAt(record);
    if (due && now.getTime() >= due.getTime()) return "REVIEW";
  }
  return record.currentState;
}

function nextDifficulty(
  r: MasteryRecord,
  obs: Observation,
  independentCorrect: boolean,
): Difficulty {
  let d: number = r.difficulty;
  const recent = r.recentOutcomes;
  if (independentCorrect && recent.length >= 2 && recent.at(-1) && recent.at(-2)) d += 1;
  else if (obs.outcome === "INCORRECT" && recent.length >= 2 && !recent.at(-1) && !recent.at(-2))
    d -= 1;
  // Stay in the zone: the target never races far ahead of the estimated skill.
  const ceiling =
    r.masteryScore < THRESHOLDS.learning
      ? 2
      : r.masteryScore < THRESHOLDS.practicing
        ? 3
        : r.masteryScore < THRESHOLDS.mastered
          ? 4
          : 5;
  return Math.max(1, Math.min(ceiling, Math.round(d))) as Difficulty;
}

export function applyObservation(
  record: MasteryRecord,
  obs: Observation,
): { record: MasteryRecord; event: MasteryEvent } {
  const evidence = evidenceFor(obs);
  const stateBefore = record.currentState;
  const scoreBefore = record.masteryScore;
  const independentCorrect =
    obs.outcome === "CORRECT" && obs.hintsUsed === 0 && obs.attemptNumber === 1;

  // The first observation starts from the prior, not from zero.
  const first = record.attempts === 0;
  const prior = first ? PRIOR : clamp01(record.masteryScore);
  const posterior = bktPosterior(prior, evidence, GUESS[obs.questionType], slipFor(obs.difficulty));
  let score = clamp01(posterior + (1 - posterior) * LEARN);
  // Direction is guaranteed: a correct answer never lowers the score and an incorrect one never
  // raises it (the learning term and low-evidence blends could otherwise move it the wrong way).
  score = round(obs.outcome === "CORRECT" ? Math.max(score, prior) : Math.min(score, prior));

  const attempts = record.attempts + 1;
  const correctAttempts = record.correctAttempts + (obs.outcome === "CORRECT" ? 1 : 0);
  const recentOutcomes = [...record.recentOutcomes, independentCorrect].slice(-RECENT_WINDOW);
  const hardCorrect =
    record.hardCorrect + (independentCorrect && obs.difficulty >= HARD_DIFFICULTY ? 1 : 0);

  // Spaced review: a success while due moves the schedule out; a failure moves it back in.
  const wasDue = deriveState(record, obs.at) === "REVIEW";
  let reviewStage = record.reviewStage;
  if (wasDue || stateBefore === "MASTERED") {
    reviewStage =
      obs.outcome === "CORRECT"
        ? wasDue
          ? Math.min(reviewStage + 1, REVIEW_INTERVAL_DAYS.length - 1)
          : reviewStage
        : Math.max(0, reviewStage - 1);
  }

  const next: MasteryRecord = {
    ...record,
    masteryScore: score,
    attempts,
    correctAttempts,
    incorrectAttempts: record.incorrectAttempts + (obs.outcome === "INCORRECT" ? 1 : 0),
    recentOutcomes,
    recentAccuracy: round(recentOutcomes.filter(Boolean).length / recentOutcomes.length),
    lastAttemptAt: obs.at,
    confidence: round(1 - 0.7 ** attempts),
    hardCorrect,
    reviewStage,
  };
  next.currentState = stateFor(next, stateBefore === "REVIEW" ? "MASTERED" : stateBefore);
  next.difficulty = nextDifficulty(next, obs, independentCorrect);
  if (next.currentState !== stateBefore) next.stateChangedAt = obs.at;
  const nowMastered = next.currentState === "MASTERED";
  const wasMasteredBefore = stateBefore === "MASTERED" || stateBefore === "REVIEW";
  if (nowMastered && !wasMasteredBefore) next.masteredAt = obs.at;
  else if (!nowMastered) next.masteredAt = null;

  return {
    record: next,
    event: {
      evidence,
      scoreBefore: round(scoreBefore),
      scoreAfter: score,
      stateBefore,
      stateAfter: next.currentState,
      reason: reasonFor(obs, evidence, stateBefore, next.currentState),
    },
  };
}

function reasonFor(
  obs: Observation,
  evidence: number,
  before: MasteryState,
  after: MasteryState,
): string {
  const how =
    obs.outcome === "INCORRECT"
      ? "incorrect"
      : evidence === 1
        ? "correct without help"
        : `correct with help (${obs.hintsUsed} hint(s), attempt ${obs.attemptNumber})`;
  return before === after
    ? `${how} at difficulty ${obs.difficulty}`
    : `${how} at difficulty ${obs.difficulty}; ${before} → ${after}`;
}

/**
 * The number to SHOW people as "mastery": the estimate shrunk by how much evidence stands behind
 * it. Three correct answers can push the raw estimate above 0.85, but the confidence is still only
 * about two-thirds, so the displayed figure stays modest until the evidence is there.
 */
export function displayMastery(record: Pick<MasteryRecord, "masteryScore" | "confidence">): number {
  return round(record.masteryScore * record.confidence);
}

/** Plain-language label for a state, for learner-facing screens. */
export const STATE_LABELS: Record<MasteryState, string> = {
  NOT_STARTED: "Not started",
  INTRODUCED: "Just started",
  LEARNING: "Learning",
  PRACTICING: "Practising",
  DEVELOPING: "Getting there",
  MASTERED: "Mastered",
  REVIEW: "Time to review",
};

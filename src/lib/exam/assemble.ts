import type { Rng } from "../questions/rng";
import type { AssessmentSkill } from "../questions/types";
import { bandCounts, type PaperPlan } from "./plan";
import { BANDS, type Proportions, type SkillBand } from "./structure";

/**
 * Putting a paper together from a pool of candidate questions: the right number of questions in the
 * right skill proportions, spread across the topics, never the same question twice.
 *
 * Pure: the pool and the random generator come in, a paper goes out. When the pool cannot supply a
 * skill in the proportion asked for, the paper says so (`shortfalls`) instead of pretending: the
 * achieved shares are always reported next to the target ones.
 */

export const BAND_OF: Record<AssessmentSkill, SkillBand> = {
  KNOWLEDGE_COMPREHENSION: "KNOWLEDGE_COMPREHENSION",
  APPLICATION: "APPLICATION_ANALYSIS",
  ANALYSIS: "APPLICATION_ANALYSIS",
  PROBLEM_SOLVING: "PROBLEM_SOLVING",
};

export interface Candidate<T = unknown> {
  /** Unique within the pool (the question's content hash). */
  key: string;
  objectiveId: string;
  topicCode: string;
  subtopicId: string;
  skill: AssessmentSkill;
  band: SkillBand;
  difficulty: number;
  /** A multiple-choice question. */
  choice: boolean;
  payload: T;
}

export interface PlacedItem<T = unknown> {
  section: string;
  /** Question number within the section, from 1. */
  number: number;
  /** Part within a structured question, from 1 (always 1 in a multiple-choice paper). */
  part: number;
  marks: number;
  candidate: Candidate<T>;
}

export interface Shortfall {
  band: SkillBand;
  wanted: number;
  got: number;
}

export interface AssembledPaper<T = unknown> {
  plan: PaperPlan;
  items: PlacedItem<T>[];
  /** Shares of the counted marks that each skill band really has, in percent (one decimal). */
  achieved: Proportions;
  shortfalls: Shortfall[];
}

export class NotEnoughQuestions extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotEnoughQuestions";
  }
}

const BAND_ORDER: readonly SkillBand[] = BANDS;
/** Where to look first when a skill runs short: the nearest skill. */
const NEAREST: Record<SkillBand, readonly SkillBand[]> = {
  PROBLEM_SOLVING: ["APPLICATION_ANALYSIS", "KNOWLEDGE_COMPREHENSION"],
  APPLICATION_ANALYSIS: ["KNOWLEDGE_COMPREHENSION", "PROBLEM_SOLVING"],
  KNOWLEDGE_COMPREHENSION: ["APPLICATION_ANALYSIS", "PROBLEM_SOLVING"],
};

const round1 = (n: number): number => Math.round(n * 10) / 10;

/** How much of a section's marks count: all of them, or counted/offered when the child chooses. */
const weightOf = (plan: PaperPlan, sectionId: string): number => {
  const section = plan.sections.find((s) => s.id === sectionId);
  return section ? section.counted / section.offered : 1;
};

export function achievedShares(
  plan: PaperPlan,
  items: ReadonlyArray<Pick<PlacedItem, "section" | "marks" | "candidate">>,
): Proportions {
  const marks: Record<SkillBand, number> = {
    KNOWLEDGE_COMPREHENSION: 0,
    APPLICATION_ANALYSIS: 0,
    PROBLEM_SOLVING: 0,
  };
  for (const item of items) marks[item.candidate.band] += item.marks * weightOf(plan, item.section);
  const total = BAND_ORDER.reduce((n, band) => n + marks[band], 0);
  const share = (band: SkillBand) => (total === 0 ? 0 : round1((marks[band] / total) * 100));
  return {
    KNOWLEDGE_COMPREHENSION: share("KNOWLEDGE_COMPREHENSION"),
    APPLICATION_ANALYSIS: share("APPLICATION_ANALYSIS"),
    PROBLEM_SOLVING: share("PROBLEM_SOLVING"),
  };
}

/** Bands that came out more than `tolerance` percentage points short of what was asked. */
function shortfallsFrom(
  plan: PaperPlan,
  items: ReadonlyArray<Pick<PlacedItem, "section" | "marks" | "candidate">>,
): Shortfall[] {
  const counted = plan.countedMarks;
  const out: Shortfall[] = [];
  const marks: Record<SkillBand, number> = {
    KNOWLEDGE_COMPREHENSION: 0,
    APPLICATION_ANALYSIS: 0,
    PROBLEM_SOLVING: 0,
  };
  for (const item of items) marks[item.candidate.band] += item.marks * weightOf(plan, item.section);
  for (const band of BAND_ORDER) {
    const wanted = (plan.proportions[band] / 100) * counted;
    // one question's worth of rounding is not a shortfall
    if (marks[band] < wanted - 1)
      out.push({ band, wanted: round1(wanted), got: round1(marks[band]) });
  }
  return out;
}

// ── choosing well ───────────────────────────────────────────────────────────────────────────────

interface Spread {
  topicsWanted: Map<string, number>;
  topicChosen: Map<string, number>;
  objectiveUses: Map<string, number>;
}

/** Topics in the proportions their objectives have in the pool (every topic is tested, none crowded out). */
function newSpread(pool: readonly Candidate[]): Spread {
  const objectivesByTopic = new Map<string, Set<string>>();
  for (const c of pool) {
    const set = objectivesByTopic.get(c.topicCode) ?? new Set<string>();
    set.add(c.objectiveId);
    objectivesByTopic.set(c.topicCode, set);
  }
  const total = [...objectivesByTopic.values()].reduce((n, set) => n + set.size, 0);
  return {
    topicsWanted: new Map([...objectivesByTopic].map(([topic, set]) => [topic, set.size / total])),
    topicChosen: new Map(),
    objectiveUses: new Map(),
  };
}

function take<T>(spread: Spread, candidate: Candidate<T>): void {
  spread.topicChosen.set(
    candidate.topicCode,
    (spread.topicChosen.get(candidate.topicCode) ?? 0) + 1,
  );
  spread.objectiveUses.set(
    candidate.objectiveId,
    (spread.objectiveUses.get(candidate.objectiveId) ?? 0) + 1,
  );
}

/**
 * `count` candidates from `pool`: each time, from the topic furthest behind its share, preferring an
 * objective not used yet, then a preferred kind, then a random one.
 */
function pickBalanced<T>(
  rng: Rng,
  pool: readonly Candidate<T>[],
  count: number,
  spread: Spread,
  prefer: (c: Candidate<T>) => boolean = () => true,
): Candidate<T>[] {
  const remaining = rng.shuffle(pool);
  const chosen: Candidate<T>[] = [];
  while (chosen.length < count && remaining.length > 0) {
    const made = [...spread.topicChosen.values()].reduce((n, v) => n + v, 0) + 1;
    let best = 0;
    let bestScore: [number, number, number] | null = null;
    remaining.forEach((c, index) => {
      const behind =
        (spread.topicsWanted.get(c.topicCode) ?? 0) * made -
        (spread.topicChosen.get(c.topicCode) ?? 0);
      const score: [number, number, number] = [
        -behind, // the topic furthest behind first
        spread.objectiveUses.get(c.objectiveId) ?? 0, // an objective not used yet
        prefer(c) ? 0 : 1,
      ];
      if (
        bestScore === null ||
        score[0] < bestScore[0] ||
        (score[0] === bestScore[0] &&
          (score[1] < bestScore[1] || (score[1] === bestScore[1] && score[2] < bestScore[2])))
      ) {
        best = index;
        bestScore = score;
      }
    });
    const [picked] = remaining.splice(best, 1);
    chosen.push(picked!);
    take(spread, picked!);
  }
  return chosen;
}

// ── Paper 1: multiple choice ────────────────────────────────────────────────────────────────────

export function assembleChoicePaper<T>(
  plan: PaperPlan,
  pool: readonly Candidate<T>[],
  rng: Rng,
): AssembledPaper<T> {
  const section = plan.sections[0]!;
  const total = section.offered;
  const choices = pool.filter((c) => c.choice);
  const spread = newSpread(choices);
  const want = bandCounts(total, plan.proportions);
  const picked: Candidate<T>[] = [];
  const taken = new Set<string>();
  const take_ = (candidates: readonly Candidate<T>[], n: number) => {
    const got = pickBalanced(
      rng,
      candidates.filter((c) => !taken.has(c.key)),
      n,
      spread,
    );
    for (const c of got) taken.add(c.key);
    picked.push(...got);
    return got.length;
  };

  // scarcest skill first, so that the plentiful ones do not use up its questions
  for (const band of [...BAND_ORDER].reverse()) {
    take_(
      choices.filter((c) => c.band === band),
      want[band],
    );
  }
  // what is still missing comes from the nearest skill that has questions left
  let missing = total - picked.length;
  for (const band of BAND_ORDER) {
    if (missing <= 0) break;
    const lacking = want[band] - picked.filter((c) => c.band === band).length;
    if (lacking <= 0) continue;
    for (const nearest of NEAREST[band]) {
      if (missing <= 0) break;
      missing -= take_(
        choices.filter((c) => c.band === nearest),
        Math.min(lacking, missing),
      );
    }
  }
  if (picked.length < total)
    throw new NotEnoughQuestions(
      `Only ${picked.length} multiple-choice questions are available; the paper needs ${total}.`,
    );

  // easier skills first, and within a skill the easier questions first
  const ordered = [...picked].sort(
    (a, b) =>
      BAND_ORDER.indexOf(a.band) - BAND_ORDER.indexOf(b.band) || a.difficulty - b.difficulty,
  );
  const items: PlacedItem<T>[] = ordered.map((candidate, i) => ({
    section: section.id,
    number: i + 1,
    part: 1,
    marks: section.marks[i]!,
    candidate,
  }));
  return {
    plan,
    items,
    achieved: achievedShares(plan, items),
    shortfalls: shortfallsFrom(plan, items),
  };
}

// ── Paper 2: structured questions ───────────────────────────────────────────────────────────────

/**
 * Every structured question is a small set of parts on one theme (a sub-topic where there are enough
 * questions, otherwise the topic), a part for every mark. Parts are chosen so that the skills of the
 * whole paper come out in the proportions asked for.
 */
export function assembleStructuredPaper<T>(
  plan: PaperPlan,
  pool: readonly Candidate<T>[],
  rng: Rng,
): AssembledPaper<T> {
  const spread = newSpread(pool);
  const taken = new Set<string>();
  const items: PlacedItem<T>[] = [];
  const chosenBand: Record<SkillBand, number> = {
    KNOWLEDGE_COMPREHENSION: 0,
    APPLICATION_ANALYSIS: 0,
    PROBLEM_SOLVING: 0,
  };
  let partsPlaced = 0;
  const usedSubtopics = new Set<string>();

  for (const section of plan.sections) {
    for (let q = 0; q < section.offered; q++) {
      const marks = section.marks[q]!;
      const available = pool.filter((c) => !taken.has(c.key));
      // the theme: the topic furthest behind, then a sub-topic with enough questions that is not used yet
      const made = items.length + 1;
      const topics = [...spread.topicsWanted.keys()];
      const topic = topics.reduce((best, t) =>
        (spread.topicsWanted.get(t) ?? 0) * made - (spread.topicChosen.get(t) ?? 0) >
        (spread.topicsWanted.get(best) ?? 0) * made - (spread.topicChosen.get(best) ?? 0)
          ? t
          : best,
      );
      const inTopic = available.filter((c) => c.topicCode === topic);
      const bySubtopic = new Map<string, Candidate<T>[]>();
      for (const c of inTopic)
        bySubtopic.set(c.subtopicId, [...(bySubtopic.get(c.subtopicId) ?? []), c]);
      const subtopics = rng
        .shuffle([...bySubtopic.entries()])
        .filter(([, list]) => list.length >= marks)
        .sort((a, b) => Number(usedSubtopics.has(a[0])) - Number(usedSubtopics.has(b[0])));
      const theme = subtopics[0] ?? null;
      const themePool: Candidate<T>[] = theme
        ? theme[1]
        : inTopic.length >= marks
          ? inTopic
          : [...available];
      if (theme) usedSubtopics.add(theme[0]);

      const used = new Set<string>();
      for (let part = 1; part <= marks; part++) {
        const left = themePool.filter((c) => !used.has(c.key) && !taken.has(c.key));
        const fallback = pool.filter((c) => !used.has(c.key) && !taken.has(c.key));
        const source = left.length > 0 ? left : fallback;
        if (source.length === 0)
          throw new NotEnoughQuestions(
            `The paper needs more questions than the pool holds (stopped in question ${q + 1} of section ${section.id}).`,
          );
        // the skill furthest behind its share, among those this theme can supply
        const present = BAND_ORDER.filter((b) => source.some((c) => c.band === b));
        const band = present.reduce((best, b) =>
          (plan.proportions[b] / 100) * (partsPlaced + 1) - chosenBand[b] >
          (plan.proportions[best] / 100) * (partsPlaced + 1) - chosenBand[best]
            ? b
            : best,
        );
        const [picked] = pickBalanced(
          rng,
          source.filter((c) => c.band === band),
          1,
          spread,
          // a written answer is closer to a structured paper than a choice is
          (c) => !c.choice,
        );
        used.add(picked!.key);
        taken.add(picked!.key);
        chosenBand[picked!.band] += 1;
        partsPlaced += 1;
        items.push({ section: section.id, number: q + 1, part, marks: 1, candidate: picked! });
      }
    }
  }
  return {
    plan,
    items,
    achieved: achievedShares(plan, items),
    shortfalls: shortfallsFrom(plan, items),
  };
}

export function assemble<T>(
  plan: PaperPlan,
  pool: readonly Candidate<T>[],
  rng: Rng,
): AssembledPaper<T> {
  return plan.paperNumber === 1
    ? assembleChoicePaper(plan, pool, rng)
    : assembleStructuredPaper(plan, pool, rng);
}

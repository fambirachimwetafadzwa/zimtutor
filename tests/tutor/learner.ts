import type { LearnerAnswer } from "../../src/lib/marking/spec";
import { getQuestionKey, type BankStore } from "../../src/lib/questions/bank";
import { generateQuestion } from "../../src/lib/questions/generate";
import { ALL_TEMPLATES } from "../../src/lib/questions/templates";
import type { Difficulty, ObjectiveInfo } from "../../src/lib/questions/types";
import type { CurriculumPort } from "../../src/lib/tutor/service";
import type { ObjectiveFacts } from "../../src/lib/tutor/moves";
import { OBJECTIVES, factsFor } from "./support";

/** The syllabus for the service tests: the real objectives, with fixed content text. */
export class FixtureCurriculum implements CurriculumPort {
  async objective(id: string): Promise<ObjectiveInfo | null> {
    return OBJECTIVES.find((o) => o.id === id) ?? null;
  }
  async facts(id: string): Promise<ObjectiveFacts | null> {
    const objective = OBJECTIVES.find((o) => o.id === id);
    return objective ? factsFor(objective) : null;
  }
}

/** What a learner who knows the answer would type. */
export async function rightAnswer(bank: BankStore, questionId: string): Promise<LearnerAnswer> {
  const key = await getQuestionKey(bank, questionId);
  if (!key) throw new Error(`no key for ${questionId}`);
  return key.display;
}

/** A parseable answer that is wrong, in the shape the question expects. */
export async function wrongAnswer(bank: BankStore, questionId: string): Promise<LearnerAnswer> {
  const [key, row] = await Promise.all([
    getQuestionKey(bank, questionId),
    bank.question(questionId),
  ]);
  if (!key || !row) throw new Error(`no question ${questionId}`);
  const spec = key.spec;
  switch (spec.method) {
    case "MULTIPLE_CHOICE": {
      const other = row.options?.find((o) => !spec.correct.includes(o.id));
      if (!other) throw new Error("no wrong option");
      return other.id;
    }
    case "TRUE_FALSE":
      return !spec.value;
    case "ORDERED_SEQUENCE":
      return [...spec.sequence].reverse();
    case "MATCHING_PAIRS": {
      const lefts = Object.keys(spec.pairs);
      const rights = Object.values(spec.pairs);
      return Object.fromEntries(lefts.map((l, i) => [l, rights[(i + 1) % rights.length]!]));
    }
    case "MULTI_PART": {
      const display = key.display;
      if (typeof display !== "object" || display === null || Array.isArray(display))
        throw new Error("odd multi-part answer");
      const first = Object.keys(display)[0]!;
      return { ...display, [first]: "123456789" };
    }
    case "TEXT_NORMALISED":
      return "zzz";
    case "FRACTION_EQUIVALENT":
    case "FRACTION_LOWEST_TERMS":
      return "123456789/7";
    case "NUMERIC_WITH_UNIT":
      return `123456789 ${spec.unit}`;
    default:
      return "123456789";
  }
}

/**
 * A seed for which the first question made for the objective at this difficulty satisfies `wanted`
 * (the service makes its first question from `${seed}|0`), or null when none of the first seeds does.
 */
export function seedFor(
  objective: ObjectiveInfo,
  difficulty: Difficulty,
  wanted: (q: ReturnType<typeof generateQuestion>) => boolean,
): string | null {
  for (let i = 0; i < 300; i++) {
    const seed = `find-${i}`;
    try {
      const q = generateQuestion({
        objective,
        difficulty,
        seed: `${seed}|0`,
        templates: ALL_TEMPLATES,
      });
      if (wanted(q)) return seed;
    } catch {
      return null;
    }
  }
  return null;
}

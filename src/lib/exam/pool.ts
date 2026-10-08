import { generateQuestion, type VerifiedQuestion } from "../questions/generate";
import { Rng } from "../questions/rng";
import type { Difficulty, ObjectiveInfo, QuestionTemplate } from "../questions/types";
import { BAND_OF, type Candidate } from "./assemble";
import { toMultipleChoice } from "./mcq";

/**
 * The questions a paper is chosen from: for every objective a learner's grade can practise, a handful
 * of freshly generated questions at a spread of difficulties. A whole-number answer is also offered as
 * a multiple-choice question, so that a multiple-choice paper has something to choose from in every
 * skill. The pool is a pure function of its inputs: the same seed gives the same pool.
 */

/** Mostly the middle of the range, as a real paper is, with a few easy and a few hard. */
const LEVELS: readonly Difficulty[] = [1, 2, 2, 3, 3, 3, 4, 4, 5];

export function buildPool(input: {
  objectives: readonly ObjectiveInfo[];
  templates: readonly QuestionTemplate[];
  seed: string;
  /** Questions to try for every objective. */
  perObjective?: number;
  levels?: readonly Difficulty[];
}): Candidate<VerifiedQuestion>[] {
  const perObjective = input.perObjective ?? 6;
  const levels = input.levels ?? LEVELS;
  const byKey = new Map<string, Candidate<VerifiedQuestion>>();

  const add = (q: VerifiedQuestion, topicCode: string, subtopicId: string) => {
    if (byKey.has(q.contentHash)) return;
    byKey.set(q.contentHash, {
      key: q.contentHash,
      objectiveId: q.objectiveId,
      topicCode,
      subtopicId,
      skill: q.assessmentSkill,
      band: BAND_OF[q.assessmentSkill],
      difficulty: q.difficulty,
      choice: q.marking.method === "MULTIPLE_CHOICE",
      payload: q,
    });
  };

  for (const objective of input.objectives) {
    const rng = new Rng(`${input.seed}|${objective.id}|pool`);
    const start = rng.int(0, levels.length - 1);
    for (let k = 0; k < perObjective; k++) {
      const difficulty = levels[(start + k) % levels.length]!;
      let question: VerifiedQuestion;
      try {
        question = generateQuestion({
          objective,
          difficulty,
          seed: `${input.seed}|${objective.id}|${k}`,
          templates: input.templates,
        });
      } catch {
        break; // no template covers this objective at all, or none makes a valid question
      }
      add(question, objective.topicCode, objective.subtopicId);
      const asChoice = toMultipleChoice(
        question,
        new Rng(`${input.seed}|${objective.id}|${k}|choice`),
      );
      if (asChoice) add(asChoice, objective.topicCode, objective.subtopicId);
    }
  }
  return [...byKey.values()];
}

import { secretFromKey } from "../../src/lib/ai/guards";
import type { ObjectiveFacts, TutorMove } from "../../src/lib/tutor/moves";
import { generateQuestion, type VerifiedQuestion } from "../../src/lib/questions/generate";
import { ALL_TEMPLATES } from "../../src/lib/questions/templates";
import type { Difficulty, ObjectiveInfo } from "../../src/lib/questions/types";
import { OBJECTIVES } from "../questions/support";

export { OBJECTIVES };

export const TOPIC_NAMES = {
  NUM: "Number",
  OPS: "Operations",
  MEA: "Measures",
  REL: "Relationships",
} as const;

export function factsFor(objective: ObjectiveInfo): ObjectiveFacts {
  return {
    id: objective.id,
    text: objective.text,
    grade: objective.grade,
    topicName: TOPIC_NAMES[objective.topicCode],
    subtopicName: objective.subtopicShortName,
    content: ["whole numbers up to 1 000 000", "place value of each digit"],
    activities: ["use counters to show tens and ones"],
    source: {
      title: "Revised Junior Mathematics Syllabus 2024-2030 (MoPSE)",
      page: 34,
      pageLabel: "34",
    },
  };
}

export function objectiveById(id: string): ObjectiveInfo {
  const found = OBJECTIVES.find((o) => o.id === id);
  if (!found) throw new Error(`no such objective ${id}`);
  return found;
}

export function questionFor(
  objectiveId: string,
  difficulty: Difficulty = 2,
  seed = "voice",
): VerifiedQuestion {
  return generateQuestion({
    objective: objectiveById(objectiveId),
    difficulty,
    seed,
    templates: ALL_TEMPLATES,
  });
}

export const secretOf = (q: VerifiedQuestion) =>
  secretFromKey({ spec: q.marking, display: q.correctAnswer }, q.options);

/** The answer as a learner would see it once revealed (the option's text for multiple choice). */
export function answerText(q: VerifiedQuestion): string {
  if (q.marking.method === "MULTIPLE_CHOICE") {
    const option = q.options?.find(
      (o) => q.marking.method === "MULTIPLE_CHOICE" && q.marking.correct.includes(o.id),
    );
    return option?.text ?? String(q.correctAnswer);
  }
  return typeof q.correctAnswer === "string" ? q.correctAnswer : JSON.stringify(q.correctAnswer);
}

export function hintMove(q: VerifiedQuestion, index = 0): Extract<TutorMove, { kind: "HINT" }> {
  return {
    kind: "HINT",
    objective: factsFor(objectiveById(q.objectiveId)),
    stem: q.stem,
    hint: q.hints[index]!,
    number: index + 1,
    of: q.hints.length,
    secret: secretOf(q),
  };
}

/** How a model that solved the question would say the answer, for each shape of answer. */
export function spokenAnswer(q: VerifiedQuestion): string {
  const answer = q.correctAnswer;
  if (Array.isArray(answer)) return `The correct order is ${answer.join(", ")}.`;
  if (typeof answer === "object" && answer !== null)
    return `The answer is ${Object.values(answer).join(" and ")}.`;
  return `The answer is ${answerText(q)}.`;
}

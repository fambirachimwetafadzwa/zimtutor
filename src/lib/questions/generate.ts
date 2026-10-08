import { createHash } from "node:crypto";
import { Rng } from "./rng";
import {
  generatedQuestionSchema,
  type Difficulty,
  type GeneratedQuestion,
  type ObjectiveInfo,
  type QuestionTemplate,
} from "./types";
import { verifyQuestion } from "./verify";

/**
 * Turn (objective, difficulty, seed) into a verified question. The result is a pure function of its
 * inputs: the same seed always gives the same question. A question that fails any check (schema,
 * self-consistency, hint leaks) is discarded and the next derived seed is tried — a faulty
 * generator can therefore slow generation down, but it cannot put a wrong question in front of a child.
 */

export class QuestionGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuestionGenerationError";
  }
}

export interface GenerateParams {
  objective: ObjectiveInfo;
  difficulty: Difficulty;
  seed: string;
  templates: readonly QuestionTemplate[];
  /** Restrict to one template (used by tests and the admin tools). */
  templateId?: string;
  /** Force or forbid a local setting; by default roughly half of word problems are local. */
  local?: boolean;
}

export interface VerifiedQuestion extends GeneratedQuestion {
  contentHash: string;
  seed: string;
}

const MAX_ATTEMPTS = 8;

export function contentHash(
  q: Pick<GeneratedQuestion, "objectiveId" | "stem" | "stemData" | "options" | "marking">,
): string {
  return createHash("sha256")
    .update(
      [
        q.objectiveId,
        q.stem,
        JSON.stringify(q.stemData ?? null),
        JSON.stringify(q.options ?? null),
        JSON.stringify(q.marking),
      ].join("\u0001"),
    )
    .digest("hex");
}

export function eligibleTemplates(
  templates: readonly QuestionTemplate[],
  objective: ObjectiveInfo,
  difficulty?: Difficulty,
): QuestionTemplate[] {
  const covering = templates.filter((t) => t.covers(objective));
  if (difficulty === undefined) return covering;
  // Prefer templates that suit this level; if none do, any template that covers the objective.
  const suited = covering.filter((t) => !t.levels || t.levels.includes(difficulty));
  return suited.length > 0 ? suited : covering;
}

export function generateQuestion(params: GenerateParams): VerifiedQuestion {
  const { objective, difficulty } = params;
  const candidates = eligibleTemplates(params.templates, objective, difficulty).filter(
    (t) => !params.templateId || t.id === params.templateId,
  );
  if (candidates.length === 0) {
    throw new QuestionGenerationError(
      `No question template covers objective ${objective.id} (“${objective.text}”)${params.templateId ? ` with template ${params.templateId}` : ""}`,
    );
  }
  const chooser = new Rng(`${params.seed}|${objective.id}|${difficulty}|template`);
  const failures: string[] = [];
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const seed = `${params.seed}|${attempt}`;
    const template = candidates.length === 1 ? candidates[0]! : chooser.pick(candidates);
    const rng = new Rng(`${seed}|${objective.id}|${difficulty}|${template.id}`);
    const local = params.local ?? rng.chance(0.5);
    try {
      const raw = template.generate({ objective, difficulty, rng, local });
      const question = generatedQuestionSchema.parse(raw);
      const problems = verifyQuestion(question);
      if (problems.length === 0) return { ...question, contentHash: contentHash(question), seed };
      failures.push(`${template.id}: ${problems.map((p) => p.detail).join("; ")}`);
    } catch (error) {
      failures.push(
        `${template.id}: ${error instanceof Error ? error.message.slice(0, 300) : String(error)}`,
      );
    }
  }
  throw new QuestionGenerationError(
    `Could not generate a valid question for ${objective.id} at difficulty ${difficulty} (${MAX_ATTEMPTS} attempts):\n${failures.slice(0, 3).join("\n")}`,
  );
}

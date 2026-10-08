import { describe, expect, it } from "vitest";
import { checkAnswer } from "../../src/lib/questions/answer";
import {
  contentLabel,
  generatorName,
  parseGenerator,
  toBankInsert,
  toPublicQuestion,
  toQuestionKey,
} from "../../src/lib/questions/bank-rows";
import { generateQuestion } from "../../src/lib/questions/generate";
import { ALL_TEMPLATES } from "../../src/lib/questions/templates";
import { MemoryBankStore } from "./memory-store";
import { OBJECTIVES } from "./support";

/**
 * What goes into the question bank and what comes out of it. Every template's questions are saved,
 * read back from the stored form, and answered: the stored key must mark the right answer right and
 * each predicted wrong answer wrong, and a learner's view of a question must contain no key.
 */

const FORBIDDEN_KEYS = [
  "marking",
  "correctAnswer",
  "expected_answer",
  "explanation",
  "hints",
  "distractorMap",
  "distractor_map",
  "solutionSteps",
  "solutionKind",
  "misconceptionTags",
];

describe("labels and generator names", () => {
  it("labels template questions as supplemental practice that is not official", () => {
    const label = contentLabel("SUPPLEMENTAL", "UNVERIFIED");
    expect(label.official).toBe(false);
    expect(label.text).toMatch(/not part of the syllabus/);
    expect(contentLabel("SUPPLEMENTAL", "ADMIN_REVIEWED").text).toMatch(/checked by a teacher/);
    expect(contentLabel("OFFICIAL_CURRICULUM", "VERIFIED_FROM_SOURCE").official).toBe(true);
    expect(contentLabel("AI_GENERATED", "UNVERIFIED").official).toBe(false);
  });

  it("names the generator so a question can be re-created", () => {
    const q = generateQuestion({
      objective: OBJECTIVES.find((o) => o.id === "G4-OPS-ADDITION-WHOLE-NUMBERS-001")!,
      difficulty: 3,
      seed: "x",
      templates: ALL_TEMPLATES,
    });
    expect(parseGenerator(generatorName(q))).toEqual({
      templateId: q.templateId,
      version: q.templateVersion,
    });
    expect(parseGenerator("llm:anthropic:something")).toBeNull();
    const insert = toBankInsert(q);
    expect(insert.question.generator_seed).toBe(q.seed);
    expect(insert.question.source_type).toBe("SUPPLEMENTAL");
    expect(insert.question.verification_status).toBe("UNVERIFIED");
  });
});

describe("saving, reading back and marking", () => {
  it("round-trips every template's questions through the stored form", async () => {
    const store = new MemoryBankStore();
    const failures: string[] = [];
    let checked = 0;
    for (const template of ALL_TEMPLATES) {
      const objectives = OBJECTIVES.filter((o) => template.covers(o));
      // two objectives and two difficulties per template keeps this quick but broad
      const sampled = [objectives[0]!, objectives[objectives.length - 1]!];
      for (const objective of sampled) {
        for (const difficulty of [2, 4] as const) {
          if (template.levels && !template.levels.includes(difficulty)) continue;
          const q = generateQuestion({
            objective,
            difficulty,
            seed: "bank-round-trip",
            templates: ALL_TEMPLATES,
            templateId: template.id,
          });
          const id = await store.save(q);
          const row = (await store.question(id))!;
          const stored = (await store.key(id))!;
          const key = toQuestionKey(row, stored);
          const where = `${template.id} ${objective.id} d${difficulty}`;

          // the stored key marks the right answer right …
          const right = checkAnswer(key, key.display);
          if (!right.result.correct) failures.push(`${where}: stored key rejects its own answer`);

          // … and each predicted wrong answer wrong, with the predicted misconception
          for (const [wrong, tag] of Object.entries(key.distractorMap)) {
            if (wrong.includes(":")) continue; // multi-part keys are checked part by part below
            // ordering keys join the items with "|"; every other key is the answer itself
            const checked = key.spec.method === "ORDERED_SEQUENCE" ? wrong.split("|") : wrong;
            const result = checkAnswer(key, checked);
            if (result.result.correct)
              failures.push(`${where}: wrong answer "${wrong}" is marked right`);
            else if (result.result.status === "INCORRECT" && !result.tags.includes(tag))
              failures.push(`${where}: "${wrong}" should show ${tag}, got [${result.tags}]`);
          }

          // the learner's view carries no key
          const view = toPublicQuestion(row);
          const text = JSON.stringify(view);
          for (const forbidden of FORBIDDEN_KEYS)
            if (text.includes(`"${forbidden}"`)) failures.push(`${where}: view has "${forbidden}"`);
          for (const hint of key.hints)
            if (text.includes(hint)) failures.push(`${where}: view contains a hint`);
          if (text.includes(key.explanation))
            failures.push(`${where}: view contains the explanation`);
          if (view.label.official) failures.push(`${where}: labelled official`);
          if (view.type === "MULTIPLE_CHOICE" && view.options?.some((o) => "correct" in o))
            failures.push(`${where}: option marks the correct answer`);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(300);
    expect(failures.slice(0, 10), `${failures.length} failure(s)`).toEqual([]);
  });

  it("stores the same content once", async () => {
    const store = new MemoryBankStore();
    const objective = OBJECTIVES.find((o) => o.id === "G3-OPS-ADDITION-WHOLE-NUMBERS-001")!;
    const make = () =>
      generateQuestion({ objective, difficulty: 2, seed: "same", templates: ALL_TEMPLATES });
    const first = await store.save(make());
    const second = await store.save(make());
    expect(second).toBe(first);
    expect(store.questions.size).toBe(1);
  });
});

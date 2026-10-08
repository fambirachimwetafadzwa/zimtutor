import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AnswerForm } from "../../src/components/learn/AnswerForm";
import { mark } from "../../src/lib/marking/mark";
import type { LearnerAnswer } from "../../src/lib/marking/spec";
import {
  answerKindOf,
  toBankInsert,
  toPublicQuestion,
  type AnswerKind,
  type PublicQuestion,
  type StoredQuestion,
} from "../../src/lib/questions/bank-rows";
import { generateQuestion, type VerifiedQuestion } from "../../src/lib/questions/generate";
import { ALL_TEMPLATES } from "../../src/lib/questions/templates";
import { OBJECTIVES } from "../questions/support";

/**
 * The form a child answers in must be the one the question is marked with. Every question the
 * templates can make is stored and read back the way the app does it, drawn as a form, and its right
 * answer -- as that form would send it -- must be marked correct.
 */

interface Sample {
  question: VerifiedQuestion;
  stored: StoredQuestion;
  pub: PublicQuestion;
}

const storedFrom = (q: VerifiedQuestion, n: number): StoredQuestion => {
  const { question: row } = toBankInsert(q);
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    learning_objective_id: row.learning_objective_id,
    grade: Number(/^G(\d)/.exec(row.learning_objective_id)![1]),
    topic_code: "NUM",
    subtopic_id: "x",
    difficulty: row.difficulty,
    question_type: row.question_type,
    assessment_skill: row.assessment_skill,
    stem: row.stem,
    stem_data: row.stem_data as Record<string, unknown>,
    options: row.options,
    marking_method: row.marking_method,
    misconception_tags: row.misconception_tags,
    uses_local_context: row.uses_local_context,
    source_type: row.source_type,
    verification_status: row.verification_status,
    generator: row.generator,
    status: "ACTIVE",
    presentation: row.presentation as Record<string, unknown>,
  };
};

/** One of each distinct (category, marking method, form) the templates produce, and a few more. */
function samples(): Sample[] {
  const seen = new Map<string, number>();
  const out: Sample[] = [];
  let n = 0;
  for (const objective of OBJECTIVES) {
    for (const difficulty of [1, 2, 3, 4, 5] as const) {
      for (const seed of ["form-a", "form-b"]) {
        let question: VerifiedQuestion;
        try {
          question = generateQuestion({ objective, difficulty, seed, templates: ALL_TEMPLATES });
        } catch {
          break;
        }
        const stored = storedFrom(question, ++n);
        const pub = toPublicQuestion(stored);
        const key = `${question.type}|${question.marking.method}|${pub.answerKind}|${question.templateId}`;
        if ((seen.get(key) ?? 0) >= 2) continue;
        seen.set(key, (seen.get(key) ?? 0) + 1);
        out.push({ question, stored, pub });
      }
    }
  }
  return out;
}

const SAMPLES = samples();

/** What each form sends when the child enters the right answer. */
function rightAnswerAsSent(kind: AnswerKind, display: LearnerAnswer): LearnerAnswer {
  if (kind === "TEXT")
    return typeof display === "string"
      ? display
      : Array.isArray(display)
        ? display.join(", ")
        : String(display);
  return display;
}

const count = (html: string, pattern: RegExp) => (html.match(pattern) ?? []).length;
const render = (pub: PublicQuestion) =>
  renderToStaticMarkup(
    createElement(AnswerForm, { question: pub, disabled: false, onSubmit: () => {} }),
  );

describe("answer forms", () => {
  it("covers the kinds of form real questions use", () => {
    const kinds = new Set(SAMPLES.map((s) => s.pub.answerKind));
    for (const kind of ["CHOICE", "ORDER", "MATCH", "BOXES", "TEXT"] as const)
      expect(kinds, `no question needs the ${kind} form`).toContain(kind);
  });

  it("is chosen by how the question is marked, whatever its category", () => {
    // a picture question can be multiple choice; a word problem can be several boxes
    const pictureChoice = SAMPLES.find(
      (s) =>
        s.question.type !== "MULTIPLE_CHOICE" && s.question.marking.method === "MULTIPLE_CHOICE",
    );
    expect(
      pictureChoice,
      "expected a non-'multiple choice' question marked as multiple choice",
    ).toBeDefined();
    expect(pictureChoice!.pub.answerKind).toBe("CHOICE");
    expect(answerKindOf("MULTIPLE_CHOICE", {})).toBe("CHOICE");
    expect(answerKindOf("TRUE_FALSE", {})).toBe("TRUE_FALSE");
    expect(answerKindOf("ORDERED_SEQUENCE", { items: ["a", "b"] })).toBe("ORDER");
    expect(answerKindOf("ORDERED_SEQUENCE", {})).toBe("TEXT");
    expect(answerKindOf("EXACT_NUMERIC", {})).toBe("TEXT");
  });

  describe.each(
    SAMPLES.map(
      (s) => [`${s.question.templateId} · ${s.question.type} · ${s.pub.answerKind}`, s] as const,
    ),
  )("%s", (_name, { question, pub }) => {
    it("offers exactly the data its form needs", () => {
      if (pub.answerKind === "CHOICE") expect(pub.options?.length).toBeGreaterThanOrEqual(2);
      else expect(pub.options).toBeUndefined();
      if (pub.answerKind === "ORDER") expect(pub.items?.length).toBeGreaterThanOrEqual(2);
      else expect(pub.items).toBeUndefined();
      if (pub.answerKind === "MATCH") expect(pub.matching?.left.length).toBeGreaterThanOrEqual(2);
      else expect(pub.matching).toBeUndefined();
      if (pub.answerKind === "BOXES") expect(pub.answerFields?.length).toBeGreaterThanOrEqual(2);
      else expect(pub.answerFields).toBeUndefined();
    });

    it("draws the form for it", () => {
      const html = render(pub);
      switch (pub.answerKind) {
        case "CHOICE":
          expect(count(html, /type="radio"/g)).toBe(pub.options!.length);
          break;
        case "TRUE_FALSE":
          expect(html).toContain(">True<");
          expect(html).toContain(">False<");
          break;
        case "ORDER":
          expect(count(html, /aria-label="Move /g)).toBe(pub.items!.length * 2);
          break;
        case "MATCH":
          expect(count(html, /<select\b/g)).toBe(pub.matching!.left.length);
          break;
        case "BOXES":
          expect(count(html, /<input\b/g)).toBe(pub.answerFields!.length);
          break;
        case "TEXT":
          expect(count(html, /<input\b/g)).toBe(1);
          expect(html).not.toContain('type="radio"');
          break;
      }
      expect(html).toContain("data-autofocus");
    });

    it("marks the right answer, as the form sends it, correct", () => {
      const sent = rightAnswerAsSent(pub.answerKind, question.correctAnswer);
      const result = mark(question.marking, sent);
      expect(result.correct, JSON.stringify({ sent, detail: result.detail })).toBe(true);
    });
  });
});

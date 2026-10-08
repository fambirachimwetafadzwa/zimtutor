import { describe, expect, it } from "vitest";
import {
  announcementFor,
  withoutRestatedQuestion,
  type MessageView,
} from "../../src/lib/tutor/view";
import type { PublicQuestion } from "../../src/lib/questions/bank-rows";

const message = (over: Partial<MessageView>): MessageView => ({
  id: "m1",
  role: "tutor",
  kind: "FEEDBACK",
  text: "Well done.",
  at: "2026-10-08T10:00:00Z",
  source: "template",
  quotes: [],
  citation: null,
  hint: null,
  question: null,
  safety: false,
  ...over,
});

const question = (stem: string) => ({ id: "q1", stem }) as unknown as PublicQuestion;

describe("what is said under an example's card", () => {
  const text = "Let's look at an example together.\n\nQuestion: Work out 9 + 8.\n\n9 + 8 = 17.";

  it("leaves out the paragraph that repeats the card's question", () => {
    expect(withoutRestatedQuestion(text, "Work out 9 + 8.")).toBe(
      "Let's look at an example together.\n\n9 + 8 = 17.",
    );
  });

  it("changes nothing when the words do not repeat the question", () => {
    const own = "Let's add nine and eight.\n\nNine plus eight is seventeen.";
    expect(withoutRestatedQuestion(own, "Work out 9 + 8.")).toBe(own);
  });

  it("only removes the exact question, never another paragraph", () => {
    expect(withoutRestatedQuestion(text, "Work out 9 + 7.")).toBe(text);
  });
});

describe("what a screen reader is told", () => {
  it("includes the question itself when a question arrives", () => {
    const spoken = announcementFor(
      message({
        kind: "QUESTION",
        text: "Here is the next question.",
        question: question("Work out 9 + 6."),
      }),
    );
    expect(spoken).toBe("Here is the next question. Work out 9 + 6.");
  });

  it("is just the words for every other message", () => {
    expect(announcementFor(message({}))).toBe("Well done.");
    // an example's own words already state its question
    expect(
      announcementFor(
        message({
          kind: "WORKED_EXAMPLE",
          text: "Question: Work out 9 + 8.",
          question: question("Work out 9 + 8."),
        }),
      ),
    ).toBe("Question: Work out 9 + 8.");
  });
});

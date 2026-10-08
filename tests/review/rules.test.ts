import { describe, expect, it } from "vitest";
import { nextReviewState, reviewQuestionSchema } from "../../src/lib/questions/review";
import {
  countFlagged,
  reviewInputSchema,
  sortFlagged,
  type FlaggedItem,
} from "../../src/lib/safety/rules";

const ID = "00000000-0000-4000-8000-000000000001";

const item = (over: Partial<FlaggedItem> & { messageId: string }): FlaggedItem => ({
  at: "2026-10-08T10:00:00Z",
  categories: ["PERSONAL_INFO"],
  content: "my number is [removed]",
  learnerId: "l1",
  learnerName: "Tendai",
  grade: 5,
  review: null,
  ...over,
});

describe("deciding about a practice question", () => {
  it("approves, rejects and reopens", () => {
    const fresh = { verification: "UNVERIFIED", status: "ACTIVE" } as const;
    expect(nextReviewState(fresh, "APPROVE")).toEqual({
      verification: "ADMIN_REVIEWED",
      status: "ACTIVE",
    });
    expect(nextReviewState(fresh, "REJECT")).toEqual({
      verification: "REJECTED",
      status: "RETIRED",
    });
    expect(nextReviewState({ verification: "REJECTED", status: "RETIRED" }, "REOPEN")).toEqual(
      fresh,
    );
  });

  it("brings a rejected question back into use when it is approved after all", () => {
    expect(nextReviewState({ verification: "REJECTED", status: "RETIRED" }, "APPROVE")).toEqual({
      verification: "ADMIN_REVIEWED",
      status: "ACTIVE",
    });
  });

  it("says when a decision changes nothing", () => {
    expect(
      nextReviewState({ verification: "ADMIN_REVIEWED", status: "ACTIVE" }, "APPROVE"),
    ).toBeNull();
    expect(nextReviewState({ verification: "REJECTED", status: "RETIRED" }, "REJECT")).toBeNull();
    expect(nextReviewState({ verification: "UNVERIFIED", status: "ACTIVE" }, "REOPEN")).toBeNull();
  });

  it("never produces a state that claims the syllabus as its source", () => {
    for (const action of ["APPROVE", "REJECT", "REOPEN"] as const) {
      const next = nextReviewState({ verification: "UNVERIFIED", status: "NEEDS_REVIEW" }, action);
      expect(next?.verification).not.toBe("VERIFIED_FROM_SOURCE");
    }
  });

  it("accepts only a question id and one of the three decisions", () => {
    expect(reviewQuestionSchema.safeParse({ questionId: ID, action: "APPROVE" }).success).toBe(
      true,
    );
    expect(reviewQuestionSchema.safeParse({ questionId: ID, action: "DELETE" }).success).toBe(
      false,
    );
    expect(
      reviewQuestionSchema.safeParse({ questionId: "1; drop table", action: "REJECT" }).success,
    ).toBe(false);
  });
});

describe("a decision about a flagged message", () => {
  it("needs a message and one of the two outcomes; the note is optional and bounded", () => {
    expect(reviewInputSchema.safeParse({ messageId: ID, outcome: "NO_CONCERN" }).success).toBe(
      true,
    );
    const withNote = reviewInputSchema.parse({
      messageId: ID,
      outcome: "ACTION_TAKEN",
      note: "  rang the school  ",
    });
    expect(withNote.note).toBe("rang the school");
    expect(
      reviewInputSchema.parse({ messageId: ID, outcome: "NO_CONCERN", note: "   " }).note,
    ).toBeUndefined();
    expect(reviewInputSchema.safeParse({ messageId: ID, outcome: "" }).success).toBe(false);
    expect(
      reviewInputSchema.safeParse({ messageId: ID, outcome: "NO_CONCERN", note: "x".repeat(1001) })
        .success,
    ).toBe(false);
    expect(reviewInputSchema.safeParse({ messageId: "nope", outcome: "NO_CONCERN" }).success).toBe(
      false,
    );
  });
});

describe("the order flagged messages are listed in", () => {
  it("puts messages nobody has looked at first, the worrying ones before the rest, newest first", () => {
    const sorted = sortFlagged([
      item({
        messageId: "reviewed-new",
        at: "2026-10-08T12:00:00Z",
        review: { outcome: "NO_CONCERN", note: null, at: "2026-10-08T13:00:00Z" },
      }),
      item({ messageId: "details-old", at: "2026-10-08T08:00:00Z" }),
      item({ messageId: "details-new", at: "2026-10-08T11:00:00Z" }),
      item({ messageId: "worrying-old", at: "2026-10-07T08:00:00Z", categories: ["WELLBEING"] }),
    ]);
    expect(sorted.map((i) => i.messageId)).toEqual([
      "worrying-old",
      "details-new",
      "details-old",
      "reviewed-new",
    ]);
  });

  it("counts what is waiting", () => {
    expect(
      countFlagged([
        item({ messageId: "a", categories: ["WELLBEING"] }),
        item({ messageId: "b" }),
        item({
          messageId: "c",
          review: { outcome: "ACTION_TAKEN", note: "x", at: "2026-10-08T13:00:00Z" },
        }),
      ]),
    ).toEqual({ open: 2, openWorrying: 1, reviewed: 1 });
    expect(countFlagged([])).toEqual({ open: 0, openWorrying: 0, reviewed: 0 });
  });
});

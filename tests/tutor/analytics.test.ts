import { describe, expect, it } from "vitest";
import {
  analyticsForTutor,
  analyticsForVoice,
  gradeOfObjective,
} from "../../src/lib/tutor/analytics";
import type { TutorEvent } from "../../src/lib/tutor/service";
import type { VoiceEvent } from "../../src/lib/tutor/voice";
import { safeFields } from "../../src/lib/monitoring/scrub";

describe("the grade in a goal's code", () => {
  it.each([
    ["G3-NUM-NUMERATION-SYSTEM-001", 3],
    ["G5-OPS-ADDITION-WHOLE-NUMBERS-001", 5],
    ["G7-NUM-WHOLE-NUMBERS-001", 7],
  ])("%s is grade %i", (id, grade) => {
    expect(gradeOfObjective(id)).toBe(grade);
  });

  it("is nothing for anything else", () => {
    for (const id of ["", "G2-NUM-X-001", "G8-NUM-X-001", "NUM-G5", "why do we carry the one"])
      expect(gradeOfObjective(id), id).toBeNull();
  });
});

describe("what the tutor's events become when counted", () => {
  it("counts a lesson starting, by grade and mode", () => {
    expect(
      analyticsForTutor({
        type: "session_started",
        mode: "LEARN",
        objectiveId: "G5-OPS-ADDITION-WHOLE-NUMBERS-001",
      }),
    ).toEqual({ name: "lesson_started", grade: 5, mode: "LEARN" });
  });

  it("does not count a lesson whose goal has no grade", () => {
    expect(
      analyticsForTutor({ type: "session_started", mode: "LEARN", objectiveId: "odd" }),
    ).toBeNull();
  });

  it("counts a lesson finishing only if something was answered", () => {
    expect(
      analyticsForTutor({ type: "session_ended", by: "LEARNER", questions: 6, firstTry: 4 }),
    ).toEqual({
      name: "lesson_finished",
      resolved: 6,
      firstTry: 4,
    });
    expect(
      analyticsForTutor({ type: "session_ended", by: "LEARNER", questions: 0, firstTry: 0 }),
    ).toBeNull();
  });

  it("counts a message that was flagged, by its kind only", () => {
    expect(
      analyticsForTutor({ type: "message_screened", categories: ["PERSONAL_INFO"], flagged: true }),
    ).toEqual({
      name: "message_flagged",
      kind: "PERSONAL_INFO",
    });
    expect(
      analyticsForTutor({
        type: "message_screened",
        categories: ["PERSONAL_INFO", "WELLBEING"],
        flagged: true,
      }),
    ).toEqual({ name: "message_flagged", kind: "PERSONAL_INFO_WELLBEING" });
    // a message that was merely tidied is not counted
    expect(
      analyticsForTutor({ type: "message_screened", categories: ["LINK"], flagged: false }),
    ).toBeNull();
  });

  it("counts nothing for what happens question by question", () => {
    const events: TutorEvent[] = [
      { type: "answer_marked", outcome: "CORRECT", questionType: "EXACT_NUMERIC", difficulty: 2 },
      { type: "hint_given", number: 1 },
      {
        type: "question_resolved",
        result: "CORRECT",
        decision: "NEXT_QUESTION",
        stateBefore: "A",
        stateAfter: "B",
      },
    ];
    for (const event of events) expect(analyticsForTutor(event), event.type).toBeNull();
  });

  it("makes counts whose facts all survive the list of what may be sent", () => {
    const counted = [
      analyticsForTutor({
        type: "session_started",
        mode: "LEARN",
        objectiveId: "G5-OPS-ADDITION-WHOLE-NUMBERS-001",
      }),
      analyticsForTutor({ type: "session_ended", by: "LEARNER", questions: 6, firstTry: 4 }),
      analyticsForTutor({ type: "message_screened", categories: ["PERSONAL_INFO"], flagged: true }),
      analyticsForVoice({ kind: "model_error", move: "EXPLAIN" } as VoiceEvent),
    ];
    for (const event of counted) {
      const { name, ...facts } = event!;
      expect(Object.keys(safeFields(facts)).sort(), name).toEqual(Object.keys(facts).sort());
    }
  });
});

describe("what the voice's events become when counted", () => {
  it("counts a fall back to the plain text, by the kind of fall back", () => {
    for (const kind of ["model_error", "model_rejected", "model_skipped"] as const)
      expect(
        analyticsForVoice({ kind, move: "EXPLAIN", reasons: ["a guard that mentions 3 + 4"] }),
      ).toEqual({
        name: "model_fallback",
        reason: kind,
      });
  });

  it("does not count a model doing its job", () => {
    expect(
      analyticsForVoice({ kind: "model_used", move: "EXPLAIN", latencyMs: 400, model: "x" }),
    ).toBeNull();
  });
});

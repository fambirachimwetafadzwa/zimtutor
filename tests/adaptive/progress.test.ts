import { describe, expect, it } from "vitest";
import { summariseProgress } from "../../src/lib/adaptive/progress";
import { displayMastery, type MasteryRecord } from "../../src/lib/mastery/engine";
import { answered, gradeObjectives, mastered, NOW, PATH } from "./support";

const summary = (
  grade: number,
  records: Array<[string, MasteryRecord]> = [],
  include?: (id: string) => boolean,
) =>
  summariseProgress({
    path: PATH,
    grade,
    mastery: new Map(records),
    now: NOW,
    ...(include ? { include } : {}),
  });

describe("progress", () => {
  it("shows every topic of the grade, with sub-topics, and counts that add up", () => {
    const s = summary(4);
    expect(s.total).toBe(gradeObjectives(4).length);
    expect(s.notStarted).toBe(s.total);
    expect(s.mastery).toBe(0);
    expect(s.topics.map((t) => t.topicCode)).toEqual(["NUM", "OPS", "MEA", "REL"]);
    expect(s.topics.reduce((a, t) => a + t.total, 0)).toBe(s.total);
    for (const t of s.topics) {
      expect(t.subtopics.reduce((a, x) => a + x.total, 0)).toBe(t.total);
      expect(t.subtopics.map((x) => x.ordinal)).toEqual(
        [...t.subtopics.map((x) => x.ordinal)].sort((a, b) => a - b),
      );
    }
  });

  it("counts each state and averages the mastery people are shown", () => {
    const [a, b, c, d] = gradeObjectives(4);
    const ra = mastered(1);
    const rb = answered([true, true]);
    const rc = answered([false, false, false]);
    const s = summary(4, [
      [a!.id, ra],
      [b!.id, rb],
      [c!.id, rc],
      [d!.id, mastered(20)], // long since practised: due for review
    ]);
    expect(s).toMatchObject({ mastered: 1, review: 1, inProgress: 2 });
    expect(s.notStarted).toBe(s.total - 4);
    const expected =
      (displayMastery(ra) +
        displayMastery(rb) +
        displayMastery(rc) +
        displayMastery(mastered(20))) /
      s.total;
    expect(s.mastery).toBeCloseTo(expected, 2);
    const row = s.topics[0]!.objectives.find((o) => o.objectiveId === a!.id);
    expect(row).toMatchObject({ state: "MASTERED", attempts: ra.attempts });
  });

  it("leaves out objectives that cannot be practised", () => {
    const left = new Set(
      gradeObjectives(5)
        .slice(0, 3)
        .map((o) => o.id),
    );
    const s = summary(5, [], (id) => !left.has(id));
    expect(s.total).toBe(gradeObjectives(5).length - 3);
    expect(s.topics.flatMap((t) => t.objectives).some((o) => left.has(o.objectiveId))).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import {
  foundationCandidates,
  isStruggling,
  recommend,
  RULES,
} from "../../src/lib/adaptive/recommend";
import { markIntroduced, newMasteryRecord, type MasteryRecord } from "../../src/lib/mastery/engine";
import { answered, daysAgo, gradeObjectives, mastered, NOW, objectiveAfter, PATH } from "./support";

const plan = (
  grade: number,
  records: Array<[string, MasteryRecord]> = [],
  extra: { practicable?: (id: string) => boolean; limit?: number } = {},
) => recommend({ path: PATH, grade, mastery: new Map(records), now: NOW, ...extra });

const ids = (queue: Array<{ objectiveId: string }>) => queue.map((r) => r.objectiveId);

describe("a learner who has not started", () => {
  const first = gradeObjectives(4);

  it("starts at the beginning of the syllabus for their grade", () => {
    const p = plan(4);
    expect(p.next?.kind).toBe("START_NEW");
    expect(p.next?.objectiveId).toBe(first[0]!.id);
    expect(p.next?.suggestedDifficulty).toBe(1);
    expect(p.counts).toMatchObject({
      total: first.length,
      notStarted: first.length,
      inProgress: 0,
      mastered: 0,
    });
    expect(p.allMastered).toBe(false);
  });

  it("does not offer the second objective of a sub-topic before the first is under way", () => {
    const p = plan(4);
    const second = first.find(
      (o) => o.subtopicId === first[0]!.subtopicId && o.ordinalInSubtopic === 2,
    );
    expect(ids(p.queue)).not.toContain(second?.id);
    // the other suggestion opens a new sub-topic instead
    const other = p.queue.find((r) => r.objectiveId !== first[0]!.id);
    expect(other).toBeDefined();
    expect(PATH.byId.get(other!.objectiveId)!.subtopicId).not.toBe(first[0]!.subtopicId);
  });

  it("points at the topic where the first objective lives", () => {
    const p = plan(4);
    expect(p.recommendedTopic?.topicId).toBe(first[0]!.topicId);
    expect(p.recommendedTopic?.topicCode).toBe("NUM");
  });
});

describe("a learner who is part-way through an objective", () => {
  const o = gradeObjectives(5)[0]!;

  it("continues an objective that was only introduced", () => {
    const p = plan(5, [[o.id, markIntroduced(newMasteryRecord(daysAgo(1)), daysAgo(1))]]);
    expect(p.next).toMatchObject({ kind: "CONTINUE", objectiveId: o.id, suggestedDifficulty: 1 });
    expect(p.next?.reason).toMatch(/started/);
  });

  it("continues with questions at the difficulty the mastery engine chose", () => {
    const record = answered([true, true, true]);
    const p = plan(5, [[o.id, record]]);
    expect(p.next).toMatchObject({ kind: "CONTINUE", objectiveId: o.id });
    expect(p.next?.suggestedDifficulty).toBe(record.difficulty);
  });

  it("moves on to the next objective once this one is developing", () => {
    const record = answered([true, true, true, true]);
    expect(["DEVELOPING", "MASTERED"]).toContain(record.currentState);
    const p = plan(5, [[o.id, record]]);
    const following = gradeObjectives(5).find(
      (x) => x.subtopicId === o.subtopicId && x.ordinalInSubtopic === o.ordinalInSubtopic + 1,
    );
    if (following) expect(ids(p.queue)).toContain(following.id);
  });

  it("holds back new objectives while too many are half-finished", () => {
    const records = gradeObjectives(5)
      .slice(0, RULES.workInProgressLimit)
      .map((x) => [x.id, answered([true, false, true])] as [string, MasteryRecord]);
    const p = plan(5, records);
    expect(p.counts.inProgress).toBe(RULES.workInProgressLimit);
    expect(p.queue.map((r) => r.kind)).not.toContain("START_NEW");
    expect(p.queue.every((r) => r.kind === "CONTINUE" || r.kind === "FOUNDATION_CHECK")).toBe(true);
  });

  it("puts the objective worked on most recently first", () => {
    const [a, b] = gradeObjectives(5);
    const p = plan(5, [
      [a!.id, answered([true, false], daysAgo(9))],
      [b!.id, answered([true, false], daysAgo(1))],
    ]);
    const continues = p.queue.filter((r) => r.kind === "CONTINUE").map((r) => r.objectiveId);
    expect(continues[0]).toBe(b!.id);
  });
});

describe("review of what was mastered", () => {
  const [a, b, c] = gradeObjectives(6);

  it("asks for a review once the interval has passed, before anything else", () => {
    const records: Array<[string, MasteryRecord]> = [
      [a!.id, mastered(10)], // mastered, last practised 10 days ago: due after 3
      [b!.id, answered([true, false, true])],
    ];
    const p = plan(6, records);
    expect(p.next).toMatchObject({ kind: "REVIEW_DUE", objectiveId: a!.id });
    expect(p.next?.reason).toMatch(/^You learned to /);
    expect(p.counts.reviewDue).toBe(1);
    expect(p.recommendedTopic?.reason).toMatch(/review/);
  });

  it("does not ask for a review that is not due yet", () => {
    const p = plan(6, [[a!.id, mastered(1)]]);
    expect(p.queue.map((r) => r.kind)).not.toContain("REVIEW_DUE");
    expect(p.counts.mastered).toBe(1);
  });

  it("puts the review that is most overdue first", () => {
    const p = plan(6, [
      [a!.id, mastered(5)],
      [b!.id, mastered(40)],
      [c!.id, mastered(12)],
    ]);
    const reviews = p.queue.filter((r) => r.kind === "REVIEW_DUE").map((r) => r.objectiveId);
    expect(reviews).toEqual([b!.id, c!.id, a!.id]);
  });
});

describe("a learner who keeps getting an objective wrong", () => {
  it("recognises struggling by accuracy and by wrong answers in a row", () => {
    expect(isStruggling(answered([false, false, false]))).toBe(true);
    expect(isStruggling(answered([true, false, false, false]))).toBe(true);
    expect(isStruggling(answered([false, true, true, true]))).toBe(false);
    expect(isStruggling(answered([false]))).toBe(false);
    expect(isStruggling(answered([true, false, true, false, false, false]))).toBe(true);
  });

  it("first suggests the objective before it in the same sub-topic", () => {
    const hard = objectiveAfter(5, 1); // not the first of its sub-topic
    const before = PATH.inSubtopic(hard.subtopicId)
      .filter((x) => x.ordinalInSubtopic < hard.ordinalInSubtopic)
      .at(-1)!;
    const p = plan(5, [[hard.id, answered([false, false, false, true, false])]]);
    expect(p.counts.struggling).toBe(1);
    expect(p.next).toMatchObject({
      kind: "FOUNDATION_CHECK",
      objectiveId: before.id,
      forObjectiveId: hard.id,
    });
    expect(p.next?.reason).toContain("comes before");
    // the hard objective stays in the queue, with gentler questions
    const again = p.queue.find((r) => r.objectiveId === hard.id);
    expect(again?.kind).toBe("CONTINUE");
    expect(again?.reason).toMatch(/tricky/);
  });

  it("looks a grade back when nothing earlier in the sub-topic needs checking", () => {
    // the first objective of a Grade 5 sub-topic whose strand also exists in Grade 4
    const hard = gradeObjectives(5).find(
      (o) => o.ordinalInSubtopic === 1 && PATH.inStrand(4, o.strandKey).length > 0,
    )!;
    const p = plan(5, [[hard.id, answered([false, false, false])]]);
    expect(p.next?.kind).toBe("FOUNDATION_CHECK");
    expect(PATH.byId.get(p.next!.objectiveId)!.grade).toBe(4);
    expect(PATH.byId.get(p.next!.objectiveId)!.strandKey).toBe(hard.strandKey);
  });

  it("keeps going with easier questions when there is nothing earlier to check", () => {
    const hard = gradeObjectives(3)[0]!; // nothing comes before the first objective of Grade 3
    const record = answered([false, false, false, false], daysAgo(1));
    const p = plan(3, [[hard.id, record]]);
    expect(p.next?.kind).toBe("CONTINUE");
    expect(p.next?.objectiveId).toBe(hard.id);
    expect(p.next!.suggestedDifficulty).toBeLessThanOrEqual(record.difficulty);
    expect(p.next?.reason).toMatch(/tricky/);
  });

  it("skips a foundation that is already mastered", () => {
    const hard = objectiveAfter(5, 1);
    const before = PATH.inSubtopic(hard.subtopicId).filter(
      (x) => x.ordinalInSubtopic < hard.ordinalInSubtopic,
    );
    const records: Array<[string, MasteryRecord]> = [
      ...before.map((x) => [x.id, mastered(1)] as [string, MasteryRecord]),
      [hard.id, answered([false, false, false])],
    ];
    const candidates = foundationCandidates(PATH, hard, new Map(records), NOW, () => true);
    expect(candidates.map((x) => x.id)).not.toEqual(
      expect.arrayContaining(before.map((x) => x.id)),
    );
  });
});

describe("everything mastered", () => {
  it("has nothing left to recommend and says so", () => {
    const records = gradeObjectives(3).map((o) => [o.id, mastered(0.5)] as [string, MasteryRecord]);
    const p = plan(3, records);
    expect(p.allMastered).toBe(true);
    expect(p.next).toBeNull();
    expect(p.queue).toEqual([]);
    expect(p.recommendedTopic).toBeNull();
    expect(p.counts.mastered).toBe(p.counts.total);
  });
});

describe("hands-on objectives", () => {
  it("are never recommended and do not count", () => {
    const grade = gradeObjectives(4);
    const handsOn = new Set([grade[0]!.id]);
    const p = plan(4, [], { practicable: (id) => !handsOn.has(id) });
    expect(p.counts.total).toBe(grade.length - 1);
    expect(ids(p.queue)).not.toContain(grade[0]!.id);
    expect(p.next?.objectiveId).toBe(grade[1]!.id);
  });
});

describe("the plan itself", () => {
  const records = (): Array<[string, MasteryRecord]> => {
    const [a, b, c, d] = gradeObjectives(6);
    return [
      [a!.id, mastered(8)],
      [b!.id, answered([true, true, false])],
      [c!.id, answered([false, false, false, false])],
      [d!.id, markIntroduced(newMasteryRecord(daysAgo(2)), daysAgo(2))],
    ];
  };

  it("is the same every time and leaves its inputs alone", () => {
    const map = new Map(records());
    const snapshot = JSON.stringify([...map]);
    const a = recommend({ path: PATH, grade: 6, mastery: map, now: NOW });
    const b = recommend({ path: PATH, grade: 6, mastery: map, now: NOW });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify([...map])).toBe(snapshot);
  });

  it("lists each objective once, mixes kinds, and respects the limit", () => {
    const p = plan(6, records(), { limit: 5 });
    expect(p.queue.length).toBeLessThanOrEqual(5);
    expect(new Set(ids(p.queue)).size).toBe(p.queue.length);
    expect(p.queue[0]).toEqual(p.next);
    // never three of the same kind in a row while another kind is available
    const kinds = p.queue.map((r) => r.kind);
    const kindsAvailable = new Set(plan(6, records(), { limit: 50 }).queue.map((r) => r.kind));
    if (kindsAvailable.size > 1)
      for (let i = 2; i < kinds.length; i++)
        expect(kinds[i] === kinds[i - 1] && kinds[i] === kinds[i - 2]).toBe(false);
  });

  it("gives every recommendation a reason a child can read", () => {
    for (const r of plan(6, records(), { limit: 20 }).queue) {
      expect(r.reason.length).toBeGreaterThan(20);
      expect(r.reason.length).toBeLessThan(260);
      expect(r.reason).not.toMatch(/undefined|NaN|null|\s{2}/);
      expect(r.reason).toMatch(/^[A-Z]/);
      expect(r.suggestedDifficulty).toBeGreaterThanOrEqual(1);
      expect(r.suggestedDifficulty).toBeLessThanOrEqual(5);
      expect(Object.keys(r.because).length).toBeGreaterThan(0);
    }
  });

  it("only ever recommends objectives of the learner's grade, or earlier foundations", () => {
    for (const r of plan(6, records(), { limit: 20 }).queue) {
      const grade = PATH.byId.get(r.objectiveId)!.grade;
      if (r.kind === "FOUNDATION_CHECK") expect(grade).toBeLessThanOrEqual(6);
      else expect(grade).toBe(6);
    }
  });
});

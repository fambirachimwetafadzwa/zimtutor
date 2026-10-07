import { describe, expect, it } from "vitest";
import { textHash } from "../../src/ingestion/ids";
import {
  assertLoadable,
  CurriculumChangeError,
  describePlan,
  InvalidSnapshotError,
  planChanges,
  requiresAcceptance,
  type ExistingObjective,
} from "../../src/ingestion/load-db";
import { cloneSnapshot, loadSnapshot } from "./snapshot-fixture";

const snapshot = loadSnapshot();

/** What the database holds after a clean load of the snapshot. */
function existingFromSnapshot(): ExistingObjective[] {
  return snapshot.objectives.map((o) => ({
    id: o.id,
    text: o.text,
    text_hash: o.text_hash,
    subtopic_id: o.subtopic_id,
    competency_row_id: o.competency_row_id,
    ordinal_in_subtopic: o.ordinal_in_subtopic,
    ordinal_in_row: o.ordinal_in_row,
    retired_at: null,
  }));
}

describe("planChanges", () => {
  it("is a no-op when the database already holds exactly this snapshot", () => {
    const plan = planChanges(snapshot, snapshot.document.sha256, existingFromSnapshot());
    expect(plan).toMatchObject({
      documentExists: true,
      sourceChanged: false,
      added: [],
      revived: [],
      reworded: [],
      moved: [],
      retired: [],
    });
    expect(plan.unchanged).toBe(snapshot.objectives.length);
    expect(requiresAcceptance(plan)).toBe(false);
  });

  it("treats a first load as purely additive", () => {
    const plan = planChanges(snapshot, null, []);
    expect(plan.documentExists).toBe(false);
    expect(plan.added).toHaveLength(snapshot.objectives.length);
    expect(requiresAcceptance(plan)).toBe(false);
  });

  it("allows new objectives without acceptance", () => {
    const plan = planChanges(snapshot, snapshot.document.sha256, existingFromSnapshot().slice(1));
    expect(plan.added).toEqual([snapshot.objectives[0]!.id]);
    expect(requiresAcceptance(plan)).toBe(false);
  });

  it("flags reworded objectives, with the before and after wording", () => {
    const existing = existingFromSnapshot();
    existing[3] = {
      ...existing[3]!,
      text: "an older wording",
      text_hash: textHash("an older wording"),
    };
    const plan = planChanges(snapshot, snapshot.document.sha256, existing);
    expect(plan.reworded).toEqual([
      { id: existing[3]!.id, before: "an older wording", after: snapshot.objectives[3]!.text },
    ]);
    expect(requiresAcceptance(plan)).toBe(true);
    expect(describePlan(plan)).toContain("REWORDED");
    expect(describePlan(plan)).toContain("an older wording");
  });

  it("flags objectives that moved to another row or position", () => {
    const existing = existingFromSnapshot();
    existing[5] = { ...existing[5]!, ordinal_in_row: existing[5]!.ordinal_in_row + 7 };
    const plan = planChanges(snapshot, snapshot.document.sha256, existing);
    expect(plan.moved.map((m) => m.id)).toEqual([existing[5]!.id]);
    expect(requiresAcceptance(plan)).toBe(true);
  });

  it("flags active objectives that disappeared (they are retired, never deleted)", () => {
    const existing = [
      ...existingFromSnapshot(),
      {
        ...existingFromSnapshot()[0]!,
        id: "G3-NUM-GONE-001",
        text_hash: "0".repeat(64),
        retired_at: null,
      },
    ];
    const plan = planChanges(snapshot, snapshot.document.sha256, existing);
    expect(plan.retired).toEqual(["G3-NUM-GONE-001"]);
    expect(requiresAcceptance(plan)).toBe(true);
  });

  it("does not report an already-retired objective as newly retired, and flags a revival", () => {
    const existing = existingFromSnapshot();
    const retiredGone: ExistingObjective = {
      ...existing[0]!,
      id: "G3-NUM-GONE-002",
      retired_at: new Date(),
    };
    const plan1 = planChanges(snapshot, snapshot.document.sha256, [...existing, retiredGone]);
    expect(plan1.retired).toEqual([]);
    expect(requiresAcceptance(plan1)).toBe(false);

    existing[2] = { ...existing[2]!, retired_at: new Date() };
    const plan2 = planChanges(snapshot, snapshot.document.sha256, existing);
    expect(plan2.revived).toEqual([existing[2]!.id]);
    expect(requiresAcceptance(plan2)).toBe(true);
  });

  it("flags a different source PDF under the same document id", () => {
    const plan = planChanges(snapshot, "f".repeat(64), existingFromSnapshot());
    expect(plan.sourceChanged).toBe(true);
    expect(requiresAcceptance(plan)).toBe(true);
    expect(describePlan(plan)).toContain("checksum changed");
  });

  it("explains how to proceed in the error it throws", () => {
    const plan = planChanges(snapshot, "f".repeat(64), existingFromSnapshot());
    const error = new CurriculumChangeError(plan);
    expect(error.message).toContain("--accept-changes");
    expect(error.message).toContain("Learner progress is attached to objective ids");
  });
});

describe("assertLoadable", () => {
  it("returns the parsed snapshot when it is sound", () => {
    expect(assertLoadable(cloneSnapshot()).objectives).toHaveLength(snapshot.objectives.length);
  });

  it("rejects input that is not a snapshot at all", () => {
    expect(() => assertLoadable({ hello: "world" })).toThrow(InvalidSnapshotError);
  });

  it("rejects a snapshot with a structural defect, naming it", () => {
    const broken = cloneSnapshot();
    broken.objectives[0]!.competency_row_id = "G3-NUM-NOWHERE.R1";
    expect(() => assertLoadable(broken)).toThrow(/ORPHAN_OBJECTIVE/);
  });

  it("rejects a snapshot that is missing a grade", () => {
    const broken = cloneSnapshot();
    broken.grades = broken.grades.filter((g) => g.number !== 6);
    expect(() => assertLoadable(broken)).toThrow(/MISSING_GRADE/);
  });
});

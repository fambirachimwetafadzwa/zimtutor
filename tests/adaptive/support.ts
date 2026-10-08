import {
  applyObservation,
  newMasteryRecord,
  type Difficulty,
  type MasteryRecord,
} from "../../src/lib/mastery/engine";
import { pathFromSnapshot, type Path, type PathObjective } from "../../src/lib/adaptive/path";
import { loadSnapshot } from "../ingestion/snapshot-fixture";

export const PATH: Path = pathFromSnapshot(loadSnapshot());
export const NOW = new Date("2026-10-08T09:00:00Z");
export const DAY = 86_400_000;
export const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY);

/** The record a learner has after answering these questions in a row (each at the given difficulty). */
export function answered(
  outcomes: ReadonlyArray<boolean | [boolean, Difficulty]>,
  firstAt: Date = daysAgo(1),
): MasteryRecord {
  let record = newMasteryRecord(firstAt);
  let at = firstAt.getTime();
  for (const item of outcomes) {
    const [ok, difficulty] = Array.isArray(item) ? item : ([item, 3 as Difficulty] as const);
    record = applyObservation(record, {
      outcome: ok ? "CORRECT" : "INCORRECT",
      difficulty,
      hintsUsed: 0,
      attemptNumber: 1,
      questionType: "NUMERIC",
      at: new Date((at += 60_000)),
    }).record;
  }
  return record;
}

/** A record that has reached MASTERED, last practised `daysSince` days before NOW. */
export function mastered(daysSince: number): MasteryRecord {
  const record = answered(
    Array.from({ length: 8 }, () => [true, 4] as [boolean, Difficulty]),
    daysAgo(daysSince),
  );
  if (record.currentState !== "MASTERED")
    throw new Error(`expected MASTERED, got ${record.currentState}`);
  return record;
}

export const gradeObjectives = (grade: number): PathObjective[] => PATH.forGrade(grade);
/** An objective with at least `before` objectives ahead of it in its own sub-topic. */
export function objectiveAfter(grade: number, before: number): PathObjective {
  const found = gradeObjectives(grade).find((o) => o.ordinalInSubtopic > before);
  if (!found) throw new Error("no such objective");
  return found;
}

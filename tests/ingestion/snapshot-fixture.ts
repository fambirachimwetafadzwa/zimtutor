import fs from "node:fs";
import path from "node:path";
import { snapshotSchema, type CurriculumSnapshot } from "../../src/ingestion/snapshot";

/** The committed, reviewed snapshot of the real syllabus. */
export const SNAPSHOT_PATH = path.resolve(
  "curriculum/snapshots/mopse-junior-mathematics-2024-2030.json",
);

export function loadSnapshot(): CurriculumSnapshot {
  return snapshotSchema.parse(JSON.parse(fs.readFileSync(SNAPSHOT_PATH, "utf8")));
}

/** A deep copy that tests can corrupt without affecting each other. */
export function cloneSnapshot(): CurriculumSnapshot {
  return structuredClone(loadSnapshot());
}

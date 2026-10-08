import { readFileSync } from "node:fs";
import { snapshotSchema } from "../../src/ingestion/snapshot";
import { objectivesFromSnapshot } from "../../src/lib/questions/objectives";

/** The real curriculum snapshot, as ObjectiveInfo (loaded once for all question tests). */
export const OBJECTIVES = objectivesFromSnapshot(
  snapshotSchema.parse(
    JSON.parse(
      readFileSync("curriculum/snapshots/mopse-junior-mathematics-2024-2030.json", "utf8"),
    ),
  ),
);

export const DIFFICULTIES = [1, 2, 3, 4, 5] as const;

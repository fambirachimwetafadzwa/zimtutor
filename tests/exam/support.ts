import { structureFromSnapshot } from "../../src/lib/exam/structure";
import { practicableObjectiveIds } from "../../src/lib/adaptive/practice";
import { buildPool } from "../../src/lib/exam/pool";
import { ALL_TEMPLATES } from "../../src/lib/questions/templates";
import { loadSnapshot } from "../ingestion/snapshot-fixture";
import { OBJECTIVES } from "../questions/support";
import { PATH } from "../adaptive/support";

/** The official examination structure, read from the committed snapshot of the syllabus. */
export const STRUCTURE = structureFromSnapshot(loadSnapshot());

const practicable = practicableObjectiveIds(PATH);

/** A pool for a grade, built the way the application builds it (cached: building takes a second). */
const pools = new Map<string, ReturnType<typeof buildPool>>();
export function poolFor(grade: number, seed = "exam-test") {
  const key = `${grade}|${seed}`;
  let pool = pools.get(key);
  if (!pool) {
    pool = buildPool({
      objectives: OBJECTIVES.filter((o) => o.grade === grade && practicable.has(o.id)),
      templates: ALL_TEMPLATES,
      seed,
    });
    pools.set(key, pool);
  }
  return pool;
}

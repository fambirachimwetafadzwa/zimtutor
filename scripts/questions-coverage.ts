/**
 * Report which objectives have practice-question templates.
 *
 *   npm run questions:coverage              summary + the objectives with no template
 *   npm run questions:coverage -- --all     every objective with its templates
 */
import { readFileSync } from "node:fs";
import { snapshotSchema } from "../src/ingestion/snapshot";
import { coverageReport } from "../src/lib/questions/coverage";
import { objectivesFromSnapshot } from "../src/lib/questions/objectives";
import { ALL_TEMPLATES } from "../src/lib/questions/templates";
import { parseArgs } from "./lib/connect";

const args = parseArgs(process.argv.slice(2));
const snapshot = snapshotSchema.parse(
  JSON.parse(readFileSync("curriculum/snapshots/mopse-junior-mathematics-2024-2030.json", "utf8")),
);
const report = coverageReport(objectivesFromSnapshot(snapshot), ALL_TEMPLATES);

const pct = (n: number, d: number) => `${Math.round((100 * n) / d)}%`;
console.log(
  `Objectives with practice templates: ${report.covered.length} of ${report.rows.length} (${pct(report.covered.length, report.rows.length)})`,
);
for (const grade of [3, 4, 5, 6, 7]) {
  const inGrade = report.rows.filter((r) => r.objective.grade === grade);
  const done = inGrade.filter((r) => r.templateIds.length > 0).length;
  console.log(`  Grade ${grade}: ${done} of ${inGrade.length}`);
}
if (report.unusedTemplates.length > 0)
  console.log(`\nTemplates that match no objective: ${report.unusedTemplates.join(", ")}`);

const rows = args.has("all") ? report.rows : report.uncovered;
console.log(args.has("all") ? "\nAll objectives:" : "\nObjectives with NO template:");
for (const row of rows)
  console.log(
    `  ${row.objective.id}  ${row.objective.text}${row.templateIds.length ? `  [${row.templateIds.join(", ")}]` : ""}`,
  );

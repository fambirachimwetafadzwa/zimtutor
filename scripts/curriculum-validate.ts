/**
 * Validate a curriculum snapshot. Exits non-zero (and prints why) if it is structurally unsound.
 *
 *   npm run curriculum:validate                       validate curriculum/snapshots/<document>.json
 *   npm run curriculum:validate -- path/to/file.json  validate another file
 *   npm run curriculum:validate -- --strict           treat warnings as failures too
 */
import fs from "node:fs";
import path from "node:path";
import { snapshotSchema } from "../src/ingestion/snapshot";
import { formatIssues, validateSnapshot } from "../src/ingestion/validate";

function main() {
  const args = process.argv.slice(2);
  const strict = args.includes("--strict");
  const file =
    args.find((a) => !a.startsWith("--")) ??
    path.join(
      "curriculum",
      "snapshots",
      `${(JSON.parse(fs.readFileSync("curriculum/source/manifest.json", "utf8")) as { document_id: string }).document_id}.json`,
    );

  const parsed = snapshotSchema.safeParse(JSON.parse(fs.readFileSync(file, "utf8")));
  if (!parsed.success) {
    console.error(`${file} does not match the snapshot schema:`);
    for (const issue of parsed.error.issues.slice(0, 20))
      console.error(`  ${issue.path.join(".")}: ${issue.message}`);
    process.exit(1);
  }
  const issues = validateSnapshot(parsed.data);
  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");
  if (issues.length > 0) console.log(formatIssues(issues));
  console.log(`\n${file}: ${errors.length} error(s), ${warnings.length} warning(s)`);
  if (errors.length > 0 || (strict && warnings.length > 0)) {
    console.error("Curriculum validation FAILED.");
    process.exit(1);
  }
  console.log("Curriculum validation passed.");
}

main();

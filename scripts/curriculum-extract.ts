/**
 * Extract the official syllabus PDF into a curriculum snapshot (JSON).
 *
 *   npm run curriculum:extract                         write curriculum/snapshots/<document>.json
 *   npm run curriculum:extract -- --out /tmp/x.json    write elsewhere
 *   npm run curriculum:extract -- --allow-issues       write even if extraction found issues (discovery only)
 *   npm run curriculum:extract -- --check              extract and verify the committed snapshot is up to date
 *
 * The run is deterministic: the same PDF always yields byte-identical output.
 */
import fs from "node:fs";
import path from "node:path";
import { extractSnapshot } from "../src/ingestion/extract";
import { serializeSnapshot, summarizeSnapshot } from "../src/ingestion/serialize";

interface Args {
  out?: string;
  allowIssues: boolean;
  check: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { allowIssues: false, check: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out") args.out = argv[++i];
    else if (a === "--allow-issues") args.allowIssues = true;
    else if (a === "--check") args.check = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = path.resolve("curriculum");
  const manifestPath = path.join(root, "source", "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
    document_id: string;
    file: string;
  };
  const defaultOut = path.join(root, "snapshots", `${manifest.document_id}.json`);
  const out = path.resolve(args.out ?? defaultOut);

  const { snapshot, issues } = await extractSnapshot({
    pdfPath: path.join(root, "source", manifest.file),
    manifestPath,
    overridesPath: path.join(root, "overrides", `${manifest.document_id}.json`),
  });

  console.log(summarizeSnapshot(snapshot));

  if (issues.length > 0) {
    console.error(`\n${issues.length} extraction issue(s):`);
    for (const issue of issues) console.error(`  [${issue.code}] ${issue.message}`);
    if (!args.allowIssues) {
      console.error(
        "\nNothing was written. Fix the issues (or add reviewed overrides), or pass --allow-issues to inspect the output.",
      );
      process.exit(1);
    }
  }

  const json = serializeSnapshot(snapshot);
  if (args.check) {
    const existing = fs.existsSync(out) ? fs.readFileSync(out, "utf8") : null;
    if (existing !== json) {
      console.error(
        `\n${out} is ${existing === null ? "missing" : "out of date"}. Run: npm run curriculum:extract`,
      );
      process.exit(1);
    }
    console.log(`\n${out} is up to date.`);
    return;
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, json);
  console.log(
    `\nWrote ${path.relative(process.cwd(), out)} (${(json.length / 1024).toFixed(0)} KiB)`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

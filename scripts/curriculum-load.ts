/**
 * Load the curriculum snapshot into PostgreSQL (atomic, repeatable, refuses silent changes).
 *
 *   npm run curriculum:load                         load curriculum/snapshots/<document>.json
 *   npm run curriculum:load -- --dry-run            show what would change; write nothing
 *   npm run curriculum:load -- --accept-changes     allow reworded / moved / retired objectives
 *   npm run curriculum:load -- --upload-source      also store the source PDF in the private bucket
 *   npm run curriculum:load -- path/to/snapshot.json
 *
 * Exit codes: 0 loaded · 1 failed (invalid snapshot, failed audit, database error) ·
 *             2 refused because existing curriculum records would change (re-run with --accept-changes
 *             once you have read the report).
 */
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { CurriculumAuditError, formatFindings } from "../src/ingestion/audit";
import {
  CurriculumChangeError,
  describePlan,
  InvalidSnapshotError,
  loadSnapshot,
} from "../src/ingestion/load-db";
import { SOURCES_BUCKET, uploadSourcePdf } from "../src/ingestion/upload-source";
import { connectFromEnv, parseArgs } from "./lib/connect";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = path.resolve("curriculum");
  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, "source", "manifest.json"), "utf8"),
  ) as { document_id: string; file: string };
  const snapshotPath =
    args.positional[0] ?? path.join(root, "snapshots", `${manifest.document_id}.json`);
  const raw = JSON.parse(fs.readFileSync(snapshotPath, "utf8")) as {
    document?: { id?: string; sha256?: string };
  };
  console.log(`Loading ${snapshotPath}`);

  let storagePath: string | undefined;
  if (args.has("upload-source") && !args.has("dry-run")) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key)
      throw new Error(
        "--upload-source needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
      );
    const client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    storagePath = await uploadSourcePdf(client.storage.from(SOURCES_BUCKET), {
      pdfPath: path.join(root, "source", manifest.file),
      documentId: raw.document?.id ?? manifest.document_id,
      expectedSha256: raw.document?.sha256 ?? "",
    });
    console.log(`Stored the source PDF at ${SOURCES_BUCKET}/${storagePath}`);
  }

  const sql = connectFromEnv();
  try {
    const report = await loadSnapshot(sql, raw, {
      acceptChanges: args.has("accept-changes"),
      dryRun: args.has("dry-run"),
      storagePath,
      log: console.log,
    });
    if (report.dryRun) {
      console.log("\nDry run — nothing was written.\n" + describePlan(report.plan));
      console.log(`${report.chunks.total} retrieval chunk(s) would be maintained.`);
      return;
    }
    const { chunks } = report;
    console.log(
      `\nLoaded ${report.documentId}: ${report.plan.added.length} objective(s) added, ${report.plan.unchanged} unchanged, ` +
        `${report.plan.retired.length} retired. Chunks: ${chunks.new} new, ${chunks.changed} changed, ${chunks.removed} removed.`,
    );
    if (report.audit.length > 0) console.log(`Audit notes:\n${formatFindings(report.audit)}`);
    console.log("Next: npm run curriculum:embed   (computes vectors for new or changed chunks)");
  } finally {
    await sql.end();
  }
}

main().catch((error: unknown) => {
  if (error instanceof CurriculumChangeError) {
    console.error(`\n${error.message}`);
    process.exit(2);
  }
  if (error instanceof InvalidSnapshotError || error instanceof CurriculumAuditError) {
    console.error(`\n${error.message}\nNothing was written.`);
    process.exit(1);
  }
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

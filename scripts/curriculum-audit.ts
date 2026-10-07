/**
 * Audit the curriculum as loaded in the database. Exits non-zero if it is unsound.
 *
 *   npm run curriculum:audit                       structural / provenance / retrieval-chunk checks
 *   npm run curriculum:audit -- --snapshot         also require equality with the committed snapshot
 *   npm run curriculum:audit -- --require-embeddings   treat un-embedded chunks as errors
 */
import fs from "node:fs";
import path from "node:path";
import { auditCurriculum, formatFindings } from "../src/ingestion/audit";
import { snapshotSchema } from "../src/ingestion/snapshot";
import { embeddingProviderFromEnv } from "../src/lib/ai/embeddings";
import { connectFromEnv, parseArgs } from "./lib/connect";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const requireEmbeddings = args.has("require-embeddings");

  let snapshot;
  if (args.has("snapshot")) {
    const manifest = JSON.parse(fs.readFileSync("curriculum/source/manifest.json", "utf8")) as {
      document_id: string;
    };
    const file =
      typeof args.value("snapshot") === "string"
        ? String(args.value("snapshot"))
        : path.join("curriculum", "snapshots", `${manifest.document_id}.json`);
    snapshot = snapshotSchema.parse(JSON.parse(fs.readFileSync(file, "utf8")));
  }
  let expectedEmbeddingModel: string | undefined;
  try {
    expectedEmbeddingModel = embeddingProviderFromEnv().model;
  } catch {
    /* embeddings not configured: skip the model check */
  }

  const sql = connectFromEnv();
  try {
    const findings = await auditCurriculum(sql, {
      snapshot,
      requireEmbeddings,
      expectedEmbeddingModel,
    });
    const errors = findings.filter((f) => f.severity === "error");
    if (findings.length > 0) console.log(formatFindings(findings));
    console.log(`\n${errors.length} error(s), ${findings.length - errors.length} warning(s).`);
    if (errors.length > 0) {
      console.error("Curriculum audit FAILED.");
      process.exitCode = 1;
    } else {
      console.log("Curriculum audit passed.");
    }
  } finally {
    await sql.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

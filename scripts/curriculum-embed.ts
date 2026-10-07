/**
 * Compute embeddings for curriculum chunks (idempotent, resumable).
 *
 *   npm run curriculum:embed                 embed chunks that have no vector or an out-of-date one
 *   npm run curriculum:embed -- --force      re-embed every chunk
 *   npm run curriculum:embed -- --batch=16   chunks per request
 *
 * Provider: EMBEDDING_PROVIDER=local-hash (offline default) | openai-compatible
 * (EMBEDDING_BASE_URL, EMBEDDING_API_KEY, EMBEDDING_MODEL). Only official syllabus text is sent.
 */
import { auditCurriculum, formatFindings } from "../src/ingestion/audit";
import { embedChunks } from "../src/ingestion/embed-chunks";
import { embeddingProviderFromEnv } from "../src/lib/ai/embeddings";
import { connectFromEnv, parseArgs } from "./lib/connect";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const provider = embeddingProviderFromEnv();
  const batch = Number(args.value("batch") ?? 32);
  const sql = connectFromEnv();
  try {
    const report = await embedChunks(sql, provider, {
      force: args.has("force"),
      batchSize: Number.isInteger(batch) && batch > 0 ? batch : 32,
      log: console.log,
    });
    console.log(
      `\nEmbedded ${report.embedded} of ${report.pending} pending chunk(s) with ${report.model}.`,
    );
    if (report.skippedChanged > 0)
      console.log(`${report.skippedChanged} changed while embedding; run again to pick them up.`);

    const findings = await auditCurriculum(sql, {
      requireEmbeddings: true,
      expectedEmbeddingModel: provider.model,
    });
    const problems = findings.filter(
      (f) =>
        f.code === "CHUNK_NOT_EMBEDDED" ||
        f.code === "MIXED_EMBEDDING_MODELS" ||
        f.code === "EMBEDDING_MODEL_CHANGED",
    );
    if (problems.length > 0) {
      console.error(formatFindings(problems));
      process.exitCode = 1;
    }
  } finally {
    await sql.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

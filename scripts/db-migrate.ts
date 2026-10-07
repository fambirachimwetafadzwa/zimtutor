/**
 * Apply supabase/migrations/*.sql to DATABASE_URL.
 *
 *   npm run db:migrate
 *
 * Safe to re-run: applied versions are skipped.
 */
import path from "node:path";
import postgres from "postgres";
import { config } from "dotenv";
import { applyMigrations } from "../src/lib/db/migrate";

config({ path: [".env.local", ".env"], quiet: true });

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set (see .env.example).");
    process.exit(1);
  }
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const applied = await applyMigrations(sql, path.resolve("supabase/migrations"), console.log);
    console.log(applied.length === 0 ? "Database is up to date." : `Applied ${applied.length} migration(s).`);
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

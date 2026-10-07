import fs from "node:fs";
import path from "node:path";
import type { Sql } from "postgres";

/**
 * Minimal migration runner.
 *
 * It records applied versions in `supabase_migrations.schema_migrations` — the same table the
 * Supabase CLI uses — so a database migrated by this runner can later be managed with
 * `supabase db push` (and vice-versa) without re-applying anything.
 */

export interface MigrationFile {
  version: string;
  name: string;
  file: string;
  sql: string;
}

const FILE_PATTERN = /^(\d{14})_([a-z0-9_]+)\.sql$/;

export function listMigrations(dir: string): MigrationFile[] {
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const migrations = files.map((file) => {
    const match = FILE_PATTERN.exec(file);
    if (!match) {
      throw new Error(`Migration file name must look like 20261007000100_name.sql: ${file}`);
    }
    return {
      version: match[1]!,
      name: match[2]!,
      file,
      sql: fs.readFileSync(path.join(dir, file), "utf8"),
    };
  });
  const seen = new Set<string>();
  for (const m of migrations) {
    if (seen.has(m.version)) throw new Error(`Duplicate migration version ${m.version}`);
    seen.add(m.version);
  }
  return migrations;
}

export async function applyMigrations(
  sql: Sql,
  dir: string,
  log: (message: string) => void = () => {},
): Promise<string[]> {
  await sql.unsafe(`
    create schema if not exists supabase_migrations;
    create table if not exists supabase_migrations.schema_migrations (
      version text not null primary key,
      statements text[],
      name text
    );
  `);
  const applied = new Set(
    (await sql<{ version: string }[]>`select version from supabase_migrations.schema_migrations`).map(
      (r) => r.version,
    ),
  );
  const done: string[] = [];
  for (const migration of listMigrations(dir)) {
    if (applied.has(migration.version)) {
      log(`skip   ${migration.file} (already applied)`);
      continue;
    }
    log(`apply  ${migration.file}`);
    // Each migration is atomic: it either fully applies or leaves the database untouched.
    await sql.begin(async (tx) => {
      await tx.unsafe(migration.sql);
      await tx`
        insert into supabase_migrations.schema_migrations (version, name, statements)
        values (${migration.version}, ${migration.name}, ${[migration.sql]})
      `;
    });
    done.push(migration.version);
  }
  return done;
}

import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import postgres, { type ReservedSql, type Sql } from "postgres";
import { applyMigrations } from "../../src/lib/db/migrate";

/**
 * Database test harness.
 *
 * Every test file gets its own freshly-created database (shim + all migrations), so tests are
 * isolated and exercise the REAL schema, constraints, triggers and row-level-security policies
 * — not a mock. Set TEST_DATABASE_URL to a superuser connection (e.g. the CI service container).
 */

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

export interface TestDatabase {
  /** Superuser connection (bypasses RLS) — for fixtures and assertions. */
  sql: Sql;
  url: string;
  drop(): Promise<void>;
}

export async function createTestDatabase(): Promise<TestDatabase> {
  if (!TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL is not set");
  const name = `zt_test_${randomBytes(6).toString("hex")}`;
  const admin = postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
  await admin.unsafe(`create database ${name}`);
  await admin.end();

  const url = new URL(TEST_DATABASE_URL);
  url.pathname = `/${name}`;
  const sql = postgres(url.toString(), { max: 4, onnotice: () => {} });
  await sql.unsafe(fs.readFileSync(path.resolve("tests/db/supabase-shim.sql"), "utf8"));
  await applyMigrations(sql, path.resolve("supabase/migrations"));

  return {
    sql,
    url: url.toString(),
    async drop() {
      await sql.end();
      const cleanup = postgres(TEST_DATABASE_URL!, { max: 1, onnotice: () => {} });
      await cleanup.unsafe(`drop database if exists ${name} with (force)`);
      await cleanup.end();
    },
  };
}

export type Actor = { userId: string; role?: "authenticated" | "anon" };

/**
 * Run `fn` as an API user: the `authenticated` (or `anon`) database role with the user's id in
 * the JWT claims — exactly how PostgREST/Supabase presents requests to Postgres. Always rolls back,
 * so tests cannot affect each other.
 */
export async function asUser<T>(
  sql: Sql,
  actor: Actor | "anon",
  fn: (tx: ReservedSql) => Promise<T>,
): Promise<T> {
  const conn = await sql.reserve();
  try {
    await conn.unsafe("begin");
    const role = actor === "anon" ? "anon" : (actor.role ?? "authenticated");
    await conn.unsafe(`set local role ${role}`);
    if (actor !== "anon") {
      await conn`select set_config('request.jwt.claim.sub', ${actor.userId}, true)`;
    }
    await conn`select set_config('request.jwt.claim.role', ${role}, true)`;
    return await fn(conn);
  } finally {
    await conn.unsafe("rollback").catch(() => {});
    conn.release();
  }
}

/** Run as the service role (bypasses RLS, like the Next.js server's privileged client). */
export async function asService<T>(sql: Sql, fn: (tx: ReservedSql) => Promise<T>): Promise<T> {
  const conn = await sql.reserve();
  try {
    await conn.unsafe("begin");
    await conn.unsafe("set local role service_role");
    return await fn(conn);
  } finally {
    await conn.unsafe("rollback").catch(() => {});
    conn.release();
  }
}

/** Assert a statement is rejected with a Postgres error code (default 42501 = insufficient privilege / RLS). */
export async function expectPgError(promise: PromiseLike<unknown>, code = "42501"): Promise<void> {
  try {
    await promise;
  } catch (error) {
    const actual = (error as { code?: string }).code;
    if (actual === code) return;
    throw new Error(`Expected Postgres error ${code} but got ${actual}: ${(error as Error).message}`);
  }
  throw new Error(`Expected Postgres error ${code} but the statement succeeded`);
}

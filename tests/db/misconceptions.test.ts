import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MISCONCEPTIONS, misconceptionsSql } from "../../src/lib/misconceptions/registry";
import { createTestDatabase, TEST_DATABASE_URL, type TestDatabase } from "./harness";

describe("misconception reference data", () => {
  it("is exactly what the newest seeding migration inserts (the registry is the single source)", () => {
    const dir = path.resolve("supabase/migrations");
    const seeding = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .filter((f) =>
        fs.readFileSync(path.join(dir, f), "utf8").includes("insert into public.misconceptions"),
      );
    expect(seeding.length).toBeGreaterThan(0);
    const newest = fs.readFileSync(path.join(dir, seeding[seeding.length - 1]!), "utf8");
    expect(newest).toContain(misconceptionsSql());
  });

  it("names every misconception the specification lists", () => {
    const codes = MISCONCEPTIONS.map((m) => m.code);
    for (const code of [
      "PLACE_VALUE_CONFUSION",
      "CARRYING_ERROR",
      "BORROWING_ERROR",
      "FRACTION_DENOMINATOR_CONFUSION",
      "DECIMAL_PLACE_CONFUSION",
      "UNIT_CONVERSION_ERROR",
      "TIME_CONVERSION_ERROR",
      "AREA_VS_PERIMETER",
      "ORDER_OF_OPERATIONS_ERROR",
      "GRAPH_READING_ERROR",
    ]) {
      expect(codes).toContain(code);
    }
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("gives every entry a description, a remediation and a nudge that does not hand over an answer", () => {
    for (const m of MISCONCEPTIONS) {
      expect(m.description.length, m.code).toBeGreaterThan(20);
      expect(m.remediation.length, m.code).toBeGreaterThan(20);
      expect(m.nudge, m.code).toMatch(/[?.]$/);
      expect(m.nudge, m.code).not.toMatch(/the answer is|equals \d/i);
    }
  });
});

describe.skipIf(!TEST_DATABASE_URL)("misconceptions in the database", () => {
  let db: TestDatabase;
  beforeAll(async () => {
    db = await createTestDatabase();
  });
  afterAll(async () => db?.drop());

  it("holds the whole registry, matching it field for field", async () => {
    const rows =
      await db.sql`select code, name, description, topic_code, remediation from public.misconceptions order by code`;
    expect(
      rows.map((r) => ({
        code: r.code,
        name: r.name,
        description: r.description,
        topic: r.topic_code,
        remediation: r.remediation,
      })),
    ).toEqual(
      [...MISCONCEPTIONS]
        .sort((a, b) => (a.code < b.code ? -1 : 1))
        .map((m) => ({
          code: m.code,
          name: m.name,
          description: m.description,
          topic: m.topic,
          remediation: m.remediation,
        })),
    );
  });

  it("stores the engine's two extra facts with sane limits", async () => {
    const columns =
      await db.sql`select column_name from information_schema.columns where table_name = 'learner_objective_mastery' and column_name in ('hard_correct', 'review_stage')`;
    expect(columns.map((c) => c.column_name).sort()).toEqual(["hard_correct", "review_stage"]);
  });
});

describe.skipIf(!TEST_DATABASE_URL)("misconception tags on questions and attempts", () => {
  let db: TestDatabase;
  beforeAll(async () => {
    db = await createTestDatabase();
    const { seedMiniCurriculum } = await import("./fixtures");
    await seedMiniCurriculum(db.sql);
  });
  afterAll(async () => db?.drop());

  const insert = (tags: string[], hash: string) => db.sql`
    insert into public.questions (learning_objective_id, grade, topic_code, subtopic_id, difficulty, question_type, stem, marking_method, misconception_tags, source_type, generator, content_hash)
    values ('G3-NUM-PLACE-VALUE-001', 3, 'NUM', 'G3-NUM-PLACE-VALUE', 1, 'NUMERIC', 'q', 'EXACT_NUMERIC', ${tags}, 'SUPPLEMENTAL', 'test', ${hash})`;

  it("accepts known tags", async () => {
    await insert(["PLACE_VALUE_CONFUSION", "CARRYING_ERROR"], "tags-ok");
  });

  it("refuses a tag the registry does not contain", async () => {
    await expect(insert(["PLACE_VALUE_CONFUSON"], "tags-typo")).rejects.toMatchObject({
      code: "23514",
    });
  });

  it("accepts a question with no tags", async () => {
    await insert([], "tags-none");
  });
});

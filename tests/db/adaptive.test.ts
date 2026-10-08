import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadSnapshot } from "../../src/ingestion/load-db";
import { pathFromContextRows, pathFromSnapshot, PATH_COLUMNS } from "../../src/lib/adaptive/path";
import { loadSnapshot as readSnapshot } from "../ingestion/snapshot-fixture";
import { asUser, createTestDatabase, TEST_DATABASE_URL, type TestDatabase } from "./harness";
import { seedUsers } from "./fixtures";

/** The syllabus order the planner walks, read from the database view. */
describe.skipIf(!TEST_DATABASE_URL)("the syllabus path in the database", () => {
  let db: TestDatabase;
  let users: Awaited<ReturnType<typeof seedUsers>>;
  const snapshot = readSnapshot();

  beforeAll(async () => {
    db = await createTestDatabase();
    await loadSnapshot(db.sql, snapshot);
    users = await seedUsers(db.sql);
  }, 120_000);
  afterAll(async () => db?.drop());

  const rows = (sql: TestDatabase["sql"]) =>
    sql.unsafe(`select ${PATH_COLUMNS} from public.v_objective_context where retired_at is null`);

  it("lists the same 444 objectives in the same order as the snapshot", async () => {
    const fromDb = pathFromContextRows(await rows(db.sql));
    const fromSnapshot = pathFromSnapshot(snapshot);
    expect(fromDb.all).toHaveLength(444);
    expect(fromDb.all.map((o) => o.id)).toEqual(fromSnapshot.all.map((o) => o.id));
    expect(fromDb.all.map((o) => [o.topicOrdinal, o.subtopicOrdinal])).toEqual(
      fromSnapshot.all.map((o) => [o.topicOrdinal, o.subtopicOrdinal]),
    );
  });

  it("orders each grade Number, Operations, Measures, Relationships", async () => {
    const path = pathFromContextRows(await rows(db.sql));
    for (const grade of [3, 4, 5, 6, 7]) {
      const topics = [...new Set(path.forGrade(grade).map((o) => o.topicCode))];
      expect(topics).toEqual(["NUM", "OPS", "MEA", "REL"]);
    }
  });

  it("can be read by a learner (the syllabus is not secret)", async () => {
    const seen = await asUser(db.sql, { userId: users.learnerA }, (tx) =>
      tx.unsafe(`select ${PATH_COLUMNS} from public.v_objective_context limit 5`),
    );
    expect(seen).toHaveLength(5);
  });
});

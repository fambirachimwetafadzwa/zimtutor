import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setAdminRole } from "../../src/lib/db/admin";
import { seedUsers, type TestUsers } from "./fixtures";
import { createTestDatabase, TEST_DATABASE_URL, type TestDatabase } from "./harness";

describe.skipIf(!TEST_DATABASE_URL)("admin promotion (npm run admin:promote)", () => {
  let db: TestDatabase;
  let users: TestUsers;
  let candidate: string;

  const role = async (id: string) =>
    (await db.sql`select role::text as role from public.profiles where id = ${id}`)[0]!
      .role as string;
  const appRole = async (id: string) =>
    (await db.sql`select raw_app_meta_data ->> 'role' as role from auth.users where id = ${id}`)[0]!
      .role as string | null;

  beforeAll(async () => {
    db = await createTestDatabase();
    users = await seedUsers(db.sql);
    candidate = randomUUID();
    await db.sql`insert into auth.users (id, email, raw_user_meta_data) values (${candidate}, 'Teacher@School.test', ${db.sql.json({ display_name: "Teacher" })})`;
  });
  afterAll(async () => db?.drop());

  it("promotes a parent without learners (email matched case-insensitively) and keeps app_metadata in step", async () => {
    expect(await role(candidate)).toBe("parent");
    expect(await setAdminRole(db.sql, "  teacher@school.TEST ")).toEqual({
      status: "PROMOTED",
      userId: candidate,
    });
    expect(await role(candidate)).toBe("admin");
    expect(await appRole(candidate)).toBe("admin");
  });

  it("is idempotent", async () => {
    expect(await setAdminRole(db.sql, "teacher@school.test")).toEqual({
      status: "ALREADY_ADMIN",
      userId: candidate,
    });
  });

  it("refuses learner accounts, whatever their email", async () => {
    expect(await setAdminRole(db.sql, "learnerA@learners.zimtutor.invalid")).toEqual({
      status: "REFUSED_LEARNER_ACCOUNT",
      userId: users.learnerA,
    });
    expect(await role(users.learnerA)).toBe("student");
  });

  it("refuses a parent who has linked learners (use a separate account)", async () => {
    expect(await setAdminRole(db.sql, "parentA@example.test")).toEqual({
      status: "REFUSED_HAS_LEARNERS",
      userId: users.parentA,
    });
    expect(await role(users.parentA)).toBe("parent");
  });

  it("reports an unknown email", async () => {
    expect(await setAdminRole(db.sql, "nobody@example.test")).toEqual({ status: "NOT_FOUND" });
  });

  it("revokes administrator rights", async () => {
    expect(await setAdminRole(db.sql, "teacher@school.test", { revoke: true })).toEqual({
      status: "REVOKED",
      userId: candidate,
    });
    expect(await role(candidate)).toBe("parent");
    expect(await appRole(candidate)).toBeNull();
    expect(await setAdminRole(db.sql, "teacher@school.test", { revoke: true })).toEqual({
      status: "NOT_ADMIN",
      userId: candidate,
    });
  });
});

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asService,
  asUser,
  createTestDatabase,
  expectPgError,
  TEST_DATABASE_URL,
  type TestDatabase,
} from "./harness";
import { seedUsers, type TestUsers } from "./fixtures";

/** Emulates what the Auth admin API does for a learner: insert an auth user with server-only metadata. */
async function createAuthLearner(db: TestDatabase, name: string): Promise<string> {
  const id = randomUUID();
  await db.sql`insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
               values (${id}, ${name + "@learners.zimtutor.invalid"}, ${db.sql.json({ display_name: name })}, ${db.sql.json({ role: "student" })})`;
  return id;
}

describe.skipIf(!TEST_DATABASE_URL)("provision_learner_profile", () => {
  let db: TestDatabase;
  let u: TestUsers;

  beforeAll(async () => {
    db = await createTestDatabase();
    u = await seedUsers(db.sql);
  });
  afterAll(async () => {
    await db?.drop();
  });

  it("creates the learner profile and the guardianship together", async () => {
    const id = await createAuthLearner(db, "chipo");
    await db.sql`select public.provision_learner_profile(${id}, ${u.parentA}, 5::smallint, 'chipo')`;
    const [lp] =
      await db.sql`select grade, username, created_by, onboarding_completed from public.learner_profiles where profile_id = ${id}`;
    expect(lp).toMatchObject({
      grade: 5,
      username: "chipo",
      created_by: u.parentA,
      onboarding_completed: true,
    });
    const g =
      await db.sql`select 1 from public.guardianships where parent_id = ${u.parentA} and learner_id = ${id}`;
    expect(g).toHaveLength(1);
  });

  it("is atomic: a duplicate username leaves no guardianship behind", async () => {
    const id = await createAuthLearner(db, "dup");
    await expectPgError(
      db.sql`select public.provision_learner_profile(${id}, ${u.parentA}, 4::smallint, 'tendai')`, // 'tendai' exists
      "23505",
    );
    expect(await db.sql`select 1 from public.guardianships where learner_id = ${id}`).toHaveLength(
      0,
    );
    expect(
      await db.sql`select 1 from public.learner_profiles where profile_id = ${id}`,
    ).toHaveLength(0);
  });

  it("enforces the per-parent learner limit", async () => {
    // parentB already has 1 learner; a limit of 2 allows exactly one more.
    const a = await createAuthLearner(db, "limit-a");
    await db.sql`select public.provision_learner_profile(${a}, ${u.parentB}, 3::smallint, 'limit-a', 2)`;
    const b = await createAuthLearner(db, "limit-b");
    await expectPgError(
      db.sql`select public.provision_learner_profile(${b}, ${u.parentB}, 3::smallint, 'limit-b', 2)`,
      "ZT001",
    );
    expect(
      await db.sql`select 1 from public.learner_profiles where profile_id = ${b}`,
    ).toHaveLength(0);
  });

  it("holds the limit under concurrent requests", async () => {
    const parent = randomUUID();
    await db.sql`insert into auth.users (id, email) values (${parent}, 'race@example.test')`;
    const ids = await Promise.all(
      ["racer1", "racer2", "racer3", "racer4", "racer5", "racer6"].map((n) =>
        createAuthLearner(db, n),
      ),
    );
    const results = await Promise.allSettled(
      ids.map(
        (id, i) =>
          db.sql`select public.provision_learner_profile(${id}, ${parent}, 3::smallint, ${"racer" + (i + 1)}, 3)`,
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
    const [{ n }] =
      (await db.sql`select count(*)::int as n from public.guardianships where parent_id = ${parent}`) as unknown as [
        { n: number },
      ];
    expect(n).toBe(3);
  });

  it("refuses to make a non-student a learner or a non-parent a guardian", async () => {
    await expectPgError(
      db.sql`select public.provision_learner_profile(${u.parentB}, ${u.parentA}, 3::smallint, 'nope')`,
      "P0001",
    );
    const kid = await createAuthLearner(db, "kid-guardian");
    await expectPgError(
      db.sql`select public.provision_learner_profile(${kid}, ${u.learnerA}, 3::smallint, 'kid-guardian')`,
      "P0001",
    );
  });

  it("reserves the learner email namespace: public sign-up cannot squat a learner identity", async () => {
    // What anyone can do through Supabase's public sign-up endpoint: no app_metadata.
    await expectPgError(
      db.sql`insert into auth.users (id, email) values (${randomUUID()}, 'victim@learners.zimtutor.invalid')`,
    );
    await expectPgError(
      db.sql`insert into auth.users (id, email, raw_app_meta_data)
             values (${randomUUID()}, 'victim@learners.zimtutor.invalid', ${db.sql.json({ role: "admin" })})`,
    );
    // Case tricks do not help.
    await expectPgError(
      db.sql`insert into auth.users (id, email) values (${randomUUID()}, 'Victim@LEARNERS.zimtutor.INVALID')`,
    );
    // The server (which sets app_metadata.role = student) can still create learners.
    const id = randomUUID();
    await db.sql`insert into auth.users (id, email, raw_app_meta_data)
                 values (${id}, 'okay@learners.zimtutor.invalid', ${db.sql.json({ role: "student" })})`;
    // An existing ordinary account cannot be re-pointed at the reserved domain either.
    await expectPgError(
      db.sql`update auth.users set email = 'taken@learners.zimtutor.invalid' where id = ${u.parentA}`,
    );
  });

  it("is callable only by the service role", async () => {
    const id = await createAuthLearner(db, "forbidden");
    await asUser(db.sql, { userId: u.parentA }, async (tx) => {
      await expectPgError(
        tx`select public.provision_learner_profile(${id}, ${u.parentA}, 3::smallint, 'forbidden')`,
      );
    });
    await asUser(db.sql, "anon", async (tx) => {
      await expectPgError(
        tx`select public.provision_learner_profile(${id}, ${u.parentA}, 3::smallint, 'forbidden')`,
      );
    });
    await asService(db.sql, async (tx) => {
      await tx`select public.provision_learner_profile(${id}, ${u.parentA}, 3::smallint, 'forbidden')`;
    });
  });
});

/**
 * Supabase Auth (GoTrue) creates a user in TWO steps inside one transaction: INSERT the row with
 * only provider info in app_metadata, then MERGE the caller's app_metadata. The triggers must
 * work for that real sequence — an earlier version only worked when the role was in the INSERT,
 * which is not what GoTrue does (found by running the migrations under a real GoTrue).
 */
describe.skipIf(!TEST_DATABASE_URL)("user creation the way Supabase Auth really does it", () => {
  let db: TestDatabase;
  let u: TestUsers;

  beforeAll(async () => {
    db = await createTestDatabase();
    u = await seedUsers(db.sql);
  });
  afterAll(async () => {
    await db?.drop();
  });

  const provider = { provider: "email", providers: ["email"] };
  const roleOf = async (id: string) =>
    (await db.sql`select role::text as role from public.profiles where id = ${id}`)[0]?.role;

  it("gives a learner a STUDENT profile although app_metadata.role arrives after the insert", async () => {
    const id = randomUUID();
    await db.sql.begin(async (tx) => {
      await tx`insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
               values (${id}, 'gotrue@learners.zimtutor.invalid', ${tx.json({ display_name: "Chipo" })}, ${tx.json(provider)})`;
      await tx`update auth.users set raw_app_meta_data = raw_app_meta_data || ${tx.json({ role: "student" })} where id = ${id}`;
    });
    expect(await roleOf(id)).toBe("student");
    expect(
      (await db.sql`select display_name from public.profiles where id = ${id}`)[0]?.display_name,
    ).toBe("Chipo");
    // …and provisioning, which requires a student profile, now succeeds.
    await db.sql`select public.provision_learner_profile(${id}, ${u.parentA}, 4::smallint, 'gotrue-chipo')`;
  });

  it("rejects the reserved domain when the role never arrives — checked at commit", async () => {
    const id = randomUUID();
    await expectPgError(
      db.sql.begin(async (tx) => {
        await tx`insert into auth.users (id, email, raw_app_meta_data)
                 values (${id}, 'squatter@learners.zimtutor.invalid', ${tx.json(provider)})`;
      }),
    );
    expect(await db.sql`select 1 from auth.users where id = ${id}`).toHaveLength(0);
    expect(await roleOf(id)).toBeUndefined();
  });

  it("ordinary sign-ups are parents and may use any other domain", async () => {
    const id = randomUUID();
    await db.sql.begin(async (tx) => {
      await tx`insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
               values (${id}, 'someone@example.test', ${tx.json({ display_name: "Someone" })}, ${tx.json(provider)})`;
    });
    expect(await roleOf(id)).toBe("parent");
  });

  it("never changes an administrator or a parent who already has learners into a student", async () => {
    for (const id of [u.admin, u.parentA]) {
      const before = await roleOf(id);
      await db.sql`update auth.users set raw_app_meta_data = raw_app_meta_data || ${db.sql.json({ role: "student" })} where id = ${id}`;
      expect(await roleOf(id)).toBe(before);
    }
  });

  it("does not let app_metadata.role = admin promote anyone (administrators are promoted out-of-band)", async () => {
    const id = randomUUID();
    await db.sql`insert into auth.users (id, email, raw_app_meta_data)
                 values (${id}, 'wannabe@example.test', ${db.sql.json({ ...provider, role: "admin" })})`;
    expect(await roleOf(id)).toBe("parent");
    await db.sql`update auth.users set raw_app_meta_data = raw_app_meta_data || ${db.sql.json({ role: "admin" })} where id = ${id}`;
    expect(await roleOf(id)).toBe("parent");
  });
});

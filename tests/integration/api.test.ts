import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { learnerEmail } from "../../src/lib/auth/credentials";
import { provisionLearner } from "../../src/lib/auth/learners";
import { createSupabaseProvisioningPorts } from "../../src/lib/auth/learners.server";

/**
 * Security and account behaviour THROUGH THE REAL SUPABASE API (Auth + PostgREST), not directly
 * against Postgres: exactly what a browser or a hostile client can reach.
 *
 * Needs a running stack with the migrations applied and the curriculum loaded
 * (`npm run db:migrate && npm run curriculum:load`). With the Supabase CLI:
 *
 *   supabase start
 *   INTEGRATION_SUPABASE_URL=<API URL> INTEGRATION_SUPABASE_ANON_KEY=<anon key> \
 *   INTEGRATION_SUPABASE_SERVICE_ROLE_KEY=<service_role key> npx vitest run tests/integration
 *
 * Skipped when those variables are absent.
 */

const URL = process.env.INTEGRATION_SUPABASE_URL;
const ANON = process.env.INTEGRATION_SUPABASE_ANON_KEY;
const SERVICE = process.env.INTEGRATION_SUPABASE_SERVICE_ROLE_KEY;
const configured = Boolean(URL && ANON && SERVICE);

const options = { auth: { persistSession: false, autoRefreshToken: false } } as const;
const client = (key: string) => createClient(URL!, key, options);

const run = Date.now().toString(36);
const PASSWORD = "correct horse battery staple";

interface Person {
  id: string;
  db: SupabaseClient;
}

async function signUpParent(label: string): Promise<Person> {
  const db = client(ANON!);
  const { data, error } = await db.auth.signUp({
    email: `${label}-${run}@example.test`,
    password: PASSWORD,
    options: { data: { display_name: label } },
  });
  if (error || !data.session || !data.user) {
    throw new Error(`sign-up failed (is email confirmation disabled?): ${error?.message}`);
  }
  return { id: data.user.id, db };
}

async function createLearner(parent: Person, username: string, grade: number): Promise<Person> {
  const result = await provisionLearner(createSupabaseProvisioningPorts(), parent.id, {
    displayName: username,
    username,
    password: PASSWORD,
    grade,
  });
  if (!result.ok) throw new Error(`could not create learner ${username}: ${result.error}`);
  const db = client(ANON!);
  const { data, error } = await db.auth.signInWithPassword({
    email: learnerEmail(username),
    password: PASSWORD,
  });
  if (error || !data.user) throw new Error(`learner sign-in failed: ${error?.message}`);
  return { id: data.user.id, db };
}

describe.skipIf(!configured)("the real Supabase API", () => {
  let service: SupabaseClient;
  let parentA: Person;
  let parentB: Person;
  let learnerA: Person;
  let learnerB: Person;
  let admin: Person;

  beforeAll(async () => {
    // The application code under test reads its configuration from the environment.
    process.env.NEXT_PUBLIC_SUPABASE_URL = URL;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = ANON;
    process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE;

    service = client(SERVICE!);
    parentA = await signUpParent("parenta");
    parentB = await signUpParent("parentb");
    learnerA = await createLearner(parentA, `ada${run}`, 4);
    learnerB = await createLearner(parentB, `ben${run}`, 6);
    admin = await signUpParent("admin");
    const { error } = await service.from("profiles").update({ role: "admin" }).eq("id", admin.id);
    if (error) throw error;
  }, 60_000);

  describe("anonymous visitors", () => {
    const tables = [
      "grades",
      "topics",
      "subtopics",
      "learning_objectives",
      "v_objective_context",
      "v_topic_summary",
      "curriculum_content",
      "curriculum_chunks",
      "profiles",
      "learner_profiles",
      "guardianships",
      "learner_objective_mastery",
      "questions",
      "question_keys",
      "tutor_messages",
      "supplemental_content",
      "admin_audit_log",
    ];

    it.each(tables)("cannot read %s", async (table) => {
      const { data, error } = await client(ANON!).from(table).select("*").limit(1);
      expect(error?.code, `${table}: ${JSON.stringify(data)}`).toBe("42501");
    });

    it("cannot call any application function", async () => {
      const db = client(ANON!);
      for (const [fn, args] of [
        ["search_curriculum_chunks_text", { query_text: "fractions" }],
        [
          "provision_learner_profile",
          { p_learner: parentA.id, p_parent: parentA.id, p_grade: 3, p_username: "x" },
        ],
        ["is_admin", {}],
      ] as const) {
        const { error } = await db.rpc(fn, args);
        expect(error, fn).not.toBeNull();
      }
    });

    it("cannot register on the reserved learner domain (no squatting of future usernames)", async () => {
      const { data, error } = await client(ANON!).auth.signUp({
        email: `squatter${run}@learners.zimtutor.invalid`,
        password: PASSWORD,
      });
      expect(error).not.toBeNull();
      expect(data.user).toBeNull();
    });
  });

  describe("a signed-in parent", () => {
    it("can read the whole official curriculum", async () => {
      const grades = await parentA.db.from("grades").select("number").order("number");
      expect(grades.data?.map((g) => g.number)).toEqual([3, 4, 5, 6, 7]);
      const objectives = await parentA.db
        .from("learning_objectives")
        .select("id", { count: "exact", head: true });
      expect(objectives.count).toBe(444);
      const context = await parentA.db
        .from("v_objective_context")
        .select("grade, topic_name, subtopic_short_name, source_page, verification_status")
        .eq("objective_id", "G5-NUM-PROPER-FRACTIONS-004")
        .single();
      expect(context.data).toMatchObject({
        grade: 5,
        topic_name: "Number",
        subtopic_short_name: "Proper Fractions",
        verification_status: "VERIFIED_FROM_SOURCE",
      });
    });

    it("cannot change the curriculum", async () => {
      expect(
        (
          await parentA.db
            .from("grades")
            .insert({ id: "G9", curriculum_id: "x", number: 9, label: "x" })
        ).error,
      ).not.toBeNull();
      const update = await parentA.db
        .from("learning_objectives")
        .update({ text: "hacked" })
        .eq("id", "G5-NUM-PROPER-FRACTIONS-004")
        .select();
      expect(update.data ?? []).toHaveLength(0);
      const objective = await service
        .from("learning_objectives")
        .select("text")
        .eq("id", "G5-NUM-PROPER-FRACTIONS-004")
        .single();
      expect(objective.data?.text).toBe("compare fractions");
    });

    it("sees only their own learners, and no other family's", async () => {
      const mine = await parentA.db.from("learner_profiles").select("profile_id");
      expect(mine.data?.map((l) => l.profile_id)).toEqual([learnerA.id]);
      const theirs = await parentA.db
        .from("learner_profiles")
        .select("profile_id")
        .eq("profile_id", learnerB.id);
      expect(theirs.data).toEqual([]);
      const profiles = await parentA.db.from("profiles").select("id");
      expect(new Set(profiles.data?.map((p) => p.id))).toEqual(new Set([parentA.id, learnerA.id]));
    });

    it("cannot promote themselves, by column privilege or by user metadata", async () => {
      const direct = await parentA.db
        .from("profiles")
        .update({ role: "admin" })
        .eq("id", parentA.id);
      expect(direct.error).not.toBeNull();
      await parentA.db.auth.updateUser({ data: { role: "admin" } });
      const after = await service.from("profiles").select("role").eq("id", parentA.id).single();
      expect(after.data?.role).toBe("parent");
      // But they can change their own display name.
      const rename = await parentA.db
        .from("profiles")
        .update({ display_name: "Renamed" })
        .eq("id", parentA.id)
        .select();
      expect(rename.data).toHaveLength(1);
    });

    it("cannot read or write learning data, answer keys, conversations or admin data", async () => {
      for (const table of [
        "questions",
        "supplemental_content",
        "admin_audit_log",
        "curriculum_document_pages",
      ]) {
        const { data, error } = await parentA.db.from(table).select("*").limit(1);
        expect(error ?? data?.length === 0, table).toBeTruthy();
      }
      const keys = await parentA.db.from("question_keys").select("*").limit(1);
      expect(keys.error?.code).toBe("42501");
      const write = await parentA.db
        .from("learner_objective_mastery")
        .insert({ learner_id: learnerA.id, objective_id: "G5-NUM-PROPER-FRACTIONS-004" });
      expect(write.error).not.toBeNull();
    });

    it("can use curriculum retrieval, which RLS keeps read-only", async () => {
      const { data, error } = await parentA.db.rpc("search_curriculum_chunks_text", {
        query_text: "compare fractions",
        match_count: 3,
        filter_grade: 5,
        filter_subject: "mathematics",
        filter_topic: "number",
        filter_subtopic: "proper fractions",
      });
      expect(error).toBeNull();
      expect(data?.[0]).toMatchObject({
        learning_objective_id: "G5-NUM-PROPER-FRACTIONS-004",
        source_type: "OFFICIAL_CURRICULUM",
      });
    });

    it("cannot create learner profiles directly (only the server provisions them)", async () => {
      const { error } = await parentA.db.rpc("provision_learner_profile", {
        p_learner: learnerB.id,
        p_parent: parentA.id,
        p_grade: 3,
        p_username: `steal${run}`,
      });
      expect(error).not.toBeNull();
      expect(
        (
          await service.from("guardianships").select("parent_id").eq("learner_id", learnerB.id)
        ).data?.map((g) => g.parent_id),
      ).toEqual([parentB.id]);
    });
  });

  describe("a signed-in learner", () => {
    it("is a student with the grade the parent chose, and no email of their own", async () => {
      const { data } = await service.from("profiles").select("role").eq("id", learnerA.id).single();
      expect(data?.role).toBe("student");
      const me = await learnerA.db.from("learner_profiles").select("grade, username").single();
      expect(me.data).toMatchObject({ grade: 4, username: `ada${run}` });
      const user = await learnerA.db.auth.getUser();
      expect(user.data.user?.email).toBe(`ada${run}@learners.zimtutor.invalid`);
    });

    it("reads the curriculum but sees no other learner and no parent", async () => {
      expect((await learnerA.db.from("grades").select("id")).data).toHaveLength(5);
      const learners = await learnerA.db.from("learner_profiles").select("profile_id");
      expect(learners.data?.map((l) => l.profile_id)).toEqual([learnerA.id]);
      const profiles = await learnerA.db.from("profiles").select("id");
      expect(profiles.data?.map((p) => p.id)).toEqual([learnerA.id]);
      expect(
        (await learnerA.db.from("guardianships").select("parent_id")).data?.map((g) => g.parent_id),
      ).toEqual([parentA.id]);
    });

    it("may change only their own grade, not their username or who created them", async () => {
      const ok = await learnerA.db
        .from("learner_profiles")
        .update({ grade: 5 })
        .eq("profile_id", learnerA.id)
        .select("grade");
      expect(ok.data).toEqual([{ grade: 5 }]);
      const rename = await learnerA.db
        .from("learner_profiles")
        .update({ username: "someoneelse" })
        .eq("profile_id", learnerA.id);
      expect(rename.error).not.toBeNull();
      const others = await learnerA.db
        .from("learner_profiles")
        .update({ grade: 7 })
        .eq("profile_id", learnerB.id)
        .select();
      expect(others.data ?? []).toHaveLength(0);
      expect(
        (
          await service
            .from("learner_profiles")
            .select("grade")
            .eq("profile_id", learnerB.id)
            .single()
        ).data?.grade,
      ).toBe(6);
    });

    it("cannot award themselves mastery or read answer keys", async () => {
      const write = await learnerA.db.from("learner_objective_mastery").insert({
        learner_id: learnerA.id,
        objective_id: "G4-NUM-WHOLE-NUMBERS-001",
        mastery_score: 1,
      });
      expect(write.error).not.toBeNull();
      const keys = await learnerA.db.from("question_keys").select("*").limit(1);
      expect(keys.error?.code).toBe("42501");
    });
  });

  describe("an administrator", () => {
    it("can read the page-preserved source text that parents and learners cannot", async () => {
      const pages = await admin.db
        .from("curriculum_document_pages")
        .select("page", { count: "exact", head: true });
      expect(pages.count).toBe(83);
      expect(
        (await parentA.db.from("curriculum_document_pages").select("page")).data ?? [],
      ).toHaveLength(0);
      expect(
        (await learnerA.db.from("curriculum_document_pages").select("page")).data ?? [],
      ).toHaveLength(0);
    });

    it("can see every learner (for support) but no conversation except flagged messages", async () => {
      const learners = await admin.db
        .from("learner_profiles")
        .select("profile_id")
        .in("profile_id", [learnerA.id, learnerB.id]);
      expect(learners.data).toHaveLength(2);
      // Whatever other tests have left behind, an administrator is only ever shown what the safety
      // screen flagged (already stripped of personal details) -- never an ordinary conversation.
      const messages = await admin.db.from("tutor_messages").select("id, flagged");
      expect(messages.error).toBeNull();
      expect((messages.data ?? []).every((m) => m.flagged)).toBe(true);
    });
  });

  describe("the service role", () => {
    it("can do what only the server may: read answer keys and provision learners", async () => {
      expect((await service.from("question_keys").select("*").limit(1)).error).toBeNull();
      const extra = await createLearner(parentA, `eve${run}`, 3);
      expect(extra.id).toBeTruthy();
    });
  });
});

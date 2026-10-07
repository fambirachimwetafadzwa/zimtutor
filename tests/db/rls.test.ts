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
import { seedMiniCurriculum, seedUsers, type TestUsers } from "./fixtures";

describe.skipIf(!TEST_DATABASE_URL)("row-level security and privileges", () => {
  let db: TestDatabase;
  let u: TestUsers;
  let sessionA: string;
  let questionId: string;

  beforeAll(async () => {
    db = await createTestDatabase();
    await seedMiniCurriculum(db.sql);
    u = await seedUsers(db.sql);

    sessionA = randomUUID();
    await db.sql`insert into public.tutor_sessions (id, learner_id, objective_id) values (${sessionA}, ${u.learnerA}, 'G3-NUM-PLACE-VALUE-001')`;
    await db.sql`insert into public.tutor_messages (session_id, learner_id, role, kind, content)
                 values (${sessionA}, ${u.learnerA}, 'learner', 'LEARNER_MESSAGE', 'private chat A'),
                        (${sessionA}, ${u.learnerA}, 'system', 'SAFETY', 'flagged content')`;
    await db.sql`update public.tutor_messages set flagged = true where content = 'flagged content'`;

    const [q] = await db.sql`
      insert into public.questions (learning_objective_id, grade, topic_code, subtopic_id, difficulty, question_type, stem, marking_method, source_type, generator, content_hash)
      values ('G3-NUM-PLACE-VALUE-001', 3, 'NUM', 'G3-NUM-PLACE-VALUE', 1, 'NUMERIC', 'What is the value of 5 in 352?', 'EXACT_NUMERIC', 'SUPPLEMENTAL', 'test', 'rls-q')
      returning id`;
    questionId = q!.id as string;
    await db.sql`insert into public.question_keys (question_id, expected_answer, explanation, hints)
                 values (${questionId}, ${db.sql.json({ value: 50 })}, 'The 5 is in the tens place.', ${db.sql.json(["Look at the tens place."])})`;
    await db.sql`insert into public.learner_objective_mastery (learner_id, objective_id, attempts, correct_attempts, mastery_score)
                 values (${u.learnerA}, 'G3-NUM-PLACE-VALUE-001', 2, 2, 0.4), (${u.learnerB}, 'G4-NUM-PLACE-VALUE-001', 1, 1, 0.2)`;
    await db.sql`insert into public.question_attempts (learner_id, question_id, objective_id, answer, is_correct, marking_method)
                 values (${u.learnerA}, ${questionId}, 'G3-NUM-PLACE-VALUE-001', ${db.sql.json({ value: 50 })}, true, 'EXACT_NUMERIC')`;
  });
  afterAll(async () => {
    await db?.drop();
  });

  describe("sign-up and role escalation", () => {
    it("always makes self-service sign-ups parents, ignoring a role the user puts in their own metadata", async () => {
      const id = randomUUID();
      await db.sql`insert into auth.users (id, email, raw_user_meta_data)
                   values (${id}, 'sneaky@example.test', ${db.sql.json({ role: "admin", display_name: "Sneaky" })})`;
      const [p] = await db.sql`select role, display_name from public.profiles where id = ${id}`;
      expect(p).toMatchObject({ role: "parent", display_name: "Sneaky" });
    });

    it("only provisions students from server-controlled app metadata", async () => {
      const [a] = await db.sql`select role from public.profiles where id = ${u.learnerA}`;
      expect(a?.role).toBe("student");
    });

    it("never lets app metadata mint an admin", async () => {
      const id = randomUUID();
      await db.sql`insert into auth.users (id, email, raw_app_meta_data) values (${id}, 'x@example.test', ${db.sql.json({ role: "admin" })})`;
      const [p] = await db.sql`select role from public.profiles where id = ${id}`;
      expect(p?.role).toBe("parent");
    });

    it("denies clients any UPDATE on profiles.role", async () => {
      await asUser(db.sql, { userId: u.parentA }, async (tx) => {
        await expectPgError(tx`update public.profiles set role = 'admin' where id = ${u.parentA}`);
      });
    });

    it("lets a user rename only themselves", async () => {
      await asUser(db.sql, { userId: u.parentA }, async (tx) => {
        const mine = await tx`update public.profiles set display_name = 'Renamed' where id = ${u.parentA}`;
        expect(mine.count).toBe(1);
        const theirs = await tx`update public.profiles set display_name = 'Hacked' where id = ${u.parentB}`;
        expect(theirs.count).toBe(0);
      });
    });

    it("denies clients inserting or deleting profiles", async () => {
      await asUser(db.sql, { userId: u.parentA }, async (tx) => {
        await expectPgError(tx`delete from public.profiles where id = ${u.parentB}`);
      });
      await asUser(db.sql, { userId: u.parentA }, async (tx) => {
        await expectPgError(
          tx`insert into public.profiles (id, role, display_name) values (${randomUUID()}, 'admin', 'x')`,
        );
      });
    });

    it("ignores deactivated accounts in every authorisation helper", async () => {
      await db.sql`update public.profiles set is_active = false where id = ${u.parentA}`;
      try {
        await asUser(db.sql, { userId: u.parentA }, async (tx) => {
          const [r] = await tx`select public.is_guardian_of(${u.learnerA}) as g, public.current_app_role() as r`;
          expect(r).toEqual({ g: false, r: null });
          const rows = await tx`select profile_id from public.learner_profiles`;
          expect(rows).toHaveLength(0);
        });
      } finally {
        await db.sql`update public.profiles set is_active = true where id = ${u.parentA}`;
      }
    });
  });

  describe("family boundaries", () => {
    it("lets a parent see their own child but not another family's", async () => {
      await asUser(db.sql, { userId: u.parentA }, async (tx) => {
        const kids = await tx`select profile_id from public.learner_profiles`;
        expect(kids.map((k) => k.profile_id)).toEqual([u.learnerA]);
        const profiles = await tx`select id from public.profiles order by id`;
        expect(profiles.map((p) => p.id).sort()).toEqual([u.learnerA, u.parentA].sort());
      });
    });

    it("lets a learner see only themselves", async () => {
      await asUser(db.sql, { userId: u.learnerA }, async (tx) => {
        const kids = await tx`select profile_id from public.learner_profiles`;
        expect(kids.map((k) => k.profile_id)).toEqual([u.learnerA]);
      });
    });

    it("shows mastery and attempts to the learner and their guardian only", async () => {
      await asUser(db.sql, { userId: u.learnerA }, async (tx) => {
        expect(await tx`select 1 from public.learner_objective_mastery`).toHaveLength(1);
        expect(await tx`select 1 from public.question_attempts`).toHaveLength(1);
      });
      await asUser(db.sql, { userId: u.parentA }, async (tx) => {
        expect(await tx`select 1 from public.learner_objective_mastery`).toHaveLength(1);
        expect(await tx`select 1 from public.question_attempts`).toHaveLength(1);
      });
      await asUser(db.sql, { userId: u.parentB }, async (tx) => {
        const rows = await tx`select learner_id from public.learner_objective_mastery`;
        expect(rows.map((r) => r.learner_id)).toEqual([u.learnerB]); // only their own child
        expect(await tx`select 1 from public.question_attempts`).toHaveLength(0);
      });
      await asUser(db.sql, { userId: u.learnerB }, async (tx) => {
        const rows = await tx`select learner_id from public.learner_objective_mastery`;
        expect(rows.map((r) => r.learner_id)).toEqual([u.learnerB]);
      });
    });

    it("lets a guardian (or the learner) change the grade, but never the username or another family's child", async () => {
      await asUser(db.sql, { userId: u.parentA }, async (tx) => {
        expect((await tx`update public.learner_profiles set grade = 4 where profile_id = ${u.learnerA}`).count).toBe(1);
        expect((await tx`update public.learner_profiles set grade = 5 where profile_id = ${u.learnerB}`).count).toBe(0);
      });
      await asUser(db.sql, { userId: u.learnerA }, async (tx) => {
        expect((await tx`update public.learner_profiles set grade = 5 where profile_id = ${u.learnerA}`).count).toBe(1);
      });
      await asUser(db.sql, { userId: u.learnerA }, async (tx) => {
        await expectPgError(tx`update public.learner_profiles set username = 'changed' where profile_id = ${u.learnerA}`);
      });
    });

    it("never lets a client create guardianships (so nobody can add themselves to a child)", async () => {
      await asUser(db.sql, { userId: u.parentB }, async (tx) => {
        await expectPgError(
          tx`insert into public.guardianships (parent_id, learner_id) values (${u.parentB}, ${u.learnerA})`,
        );
      });
    });
  });

  describe("private tutoring conversations", () => {
    it("lets the learner read their own messages", async () => {
      await asUser(db.sql, { userId: u.learnerA }, async (tx) => {
        const rows = await tx`select content from public.tutor_messages order by content`;
        expect(rows.map((r) => r.content)).toEqual(["flagged content", "private chat A"]);
      });
    });

    it("hides conversations from parents (they see progress, not chat)", async () => {
      await asUser(db.sql, { userId: u.parentA }, async (tx) => {
        expect(await tx`select 1 from public.tutor_messages`).toHaveLength(0);
        // ...but they can see that sessions happened.
        expect(await tx`select 1 from public.tutor_sessions`).toHaveLength(1);
      });
    });

    it("hides conversations from other learners and other parents", async () => {
      await asUser(db.sql, { userId: u.learnerB }, async (tx) => {
        expect(await tx`select 1 from public.tutor_messages`).toHaveLength(0);
      });
      await asUser(db.sql, { userId: u.parentB }, async (tx) => {
        expect(await tx`select 1 from public.tutor_messages`).toHaveLength(0);
      });
    });

    it("lets admins read ONLY safety-flagged messages", async () => {
      await asUser(db.sql, { userId: u.admin }, async (tx) => {
        const rows = await tx`select content from public.tutor_messages`;
        expect(rows.map((r) => r.content)).toEqual(["flagged content"]);
      });
    });

    it("never lets a client write messages (no fabricated tutor/system turns)", async () => {
      await asUser(db.sql, { userId: u.learnerA }, async (tx) => {
        await expectPgError(
          tx`insert into public.tutor_messages (session_id, learner_id, role, kind, content)
             values (${sessionA}, ${u.learnerA}, 'tutor', 'EXPLAIN', 'The answer is always 7')`,
        );
      });
    });
  });

  describe("answer keys and server-authoritative data", () => {
    it("denies learners, parents and admins any access to answer keys", async () => {
      for (const userId of [u.learnerA, u.parentA, u.admin]) {
        await asUser(db.sql, { userId }, async (tx) => {
          await expectPgError(tx`select expected_answer from public.question_keys`);
        });
      }
    });

    it("hides raw questions from learners/parents but lets admins review them", async () => {
      await asUser(db.sql, { userId: u.learnerA }, async (tx) => {
        expect(await tx`select 1 from public.questions`).toHaveLength(0);
      });
      await asUser(db.sql, { userId: u.admin }, async (tx) => {
        expect(await tx`select 1 from public.questions`).toHaveLength(1);
      });
    });

    it("denies a learner awarding themselves mastery or fabricating attempts", async () => {
      await asUser(db.sql, { userId: u.learnerA }, async (tx) => {
        await expectPgError(
          tx`update public.learner_objective_mastery set mastery_score = 1, current_state = 'MASTERED' where learner_id = ${u.learnerA}`,
        );
      });
      await asUser(db.sql, { userId: u.learnerA }, async (tx) => {
        await expectPgError(
          tx`insert into public.question_attempts (learner_id, question_id, objective_id, answer, is_correct, marking_method)
             values (${u.learnerA}, ${questionId}, 'G3-NUM-PLACE-VALUE-001', ${tx.json({})}, true, 'EXACT_NUMERIC')`,
        );
      });
      await asUser(db.sql, { userId: u.learnerA }, async (tx) => {
        await expectPgError(
          tx`insert into public.learner_objective_mastery (learner_id, objective_id) values (${u.learnerA}, 'G3-NUM-PLACE-VALUE-002')`,
        );
      });
    });

    it("lets the service role (the Next.js server) write all of it", async () => {
      await asService(db.sql, async (tx) => {
        await tx`insert into public.learner_objective_mastery (learner_id, objective_id) values (${u.learnerA}, 'G3-NUM-PLACE-VALUE-002')`;
        const keys = await tx`select expected_answer from public.question_keys`;
        expect(keys).toHaveLength(1);
      });
    });
  });

  describe("curriculum access", () => {
    it("lets signed-in users read the curriculum", async () => {
      await asUser(db.sql, { userId: u.learnerA }, async (tx) => {
        expect(await tx`select 1 from public.learning_objectives`).toHaveLength(3);
        expect(await tx`select 1 from public.v_objective_context`).toHaveLength(3);
      });
    });

    it("denies anonymous visitors the curriculum entirely", async () => {
      await asUser(db.sql, "anon", async (tx) => {
        await expectPgError(tx`select 1 from public.learning_objectives`);
      });
      await asUser(db.sql, "anon", async (tx) => {
        await expectPgError(tx`select 1 from public.profiles`);
      });
    });

    it("lets nobody but the pipeline modify official curriculum", async () => {
      for (const userId of [u.learnerA, u.parentA, u.admin]) {
        await asUser(db.sql, { userId }, async (tx) => {
          await expectPgError(tx`update public.learning_objectives set text = 'tampered'`);
        });
        await asUser(db.sql, { userId }, async (tx) => {
          await expectPgError(tx`delete from public.curriculum_content`);
        });
      }
    });

    it("keeps the page-preserved source text admin-only", async () => {
      await db.sql`insert into public.curriculum_document_pages (document_id, page, text) values ('doc-1', 1, 'full page text')`;
      await asUser(db.sql, { userId: u.learnerA }, async (tx) => {
        expect(await tx`select 1 from public.curriculum_document_pages`).toHaveLength(0);
      });
      await asUser(db.sql, { userId: u.admin }, async (tx) => {
        expect(await tx`select 1 from public.curriculum_document_pages`).toHaveLength(1);
      });
    });
  });

  describe("every public table is protected", () => {
    it("has row-level security enabled on all tables", async () => {
      const rows = await db.sql`
        select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity order by 1`;
      expect(rows.map((r) => r.relname)).toEqual([]);
    });

    it("grants the anonymous role no table or view privileges at all", async () => {
      const rows = await db.sql`
        select table_name, privilege_type from information_schema.role_table_grants
        where grantee = 'anon' and table_schema = 'public'`;
      expect(rows).toEqual([]);
    });

    it("gives signed-in users no write privilege on any curriculum, view, answer-key or learning table", async () => {
      const rows = await db.sql`
        select table_name, privilege_type from information_schema.role_table_grants
        where grantee = 'authenticated' and table_schema = 'public'
          and privilege_type in ('INSERT', 'DELETE', 'TRUNCATE')
        order by 1, 2`;
      expect(rows).toEqual([]);
    });

    it("limits the UPDATE privilege of signed-in users to a handful of harmless columns", async () => {
      const rows = await db.sql`
        select table_name || '.' || column_name as col from information_schema.column_privileges
        where grantee = 'authenticated' and table_schema = 'public' and privilege_type = 'UPDATE'
        order by 1`;
      expect(rows.map((r) => r.col)).toEqual([
        "learner_profiles.avatar",
        "learner_profiles.grade",
        "learner_profiles.onboarding_completed",
        "profiles.display_name",
      ]);
    });

    it("exposes only an explicit allow-list of functions to the API (PostgREST publishes them as RPC)", async () => {
      const fns = await db.sql`
        select p.proname, p.oid::regprocedure::text as signature,
               has_function_privilege('anon', p.oid, 'execute') as anon_ok,
               has_function_privilege('authenticated', p.oid, 'execute') as auth_ok
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' order by 1`;
      expect(fns.filter((f) => f.anon_ok)).toEqual([]);
      expect(fns.filter((f) => f.auth_ok).map((f) => f.proname)).toEqual([
        "can_view_learner",
        "current_app_role",
        "is_admin",
        "is_guardian_of",
        "match_curriculum_chunks",
        "search_curriculum_chunks_text",
      ]);
    });
  });
});

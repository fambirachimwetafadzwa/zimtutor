import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { changeLearnerPassword, removeFamily, removeLearner } from "../../src/lib/auth/accounts";
import { createSupabaseAccountPorts } from "../../src/lib/auth/accounts.server";
import { learnerEmail } from "../../src/lib/auth/credentials";
import { provisionLearner } from "../../src/lib/auth/learners";
import { createSupabaseProvisioningPorts } from "../../src/lib/auth/learners.server";

/**
 * Removing accounts and changing a child's password, against the real sign-in service and API: that
 * the sign-in identity really goes (nobody can sign in as it), that what was saved about the child
 * goes with it, and that nobody but a guardian can do any of it.
 */

const URL = process.env.INTEGRATION_SUPABASE_URL;
const ANON = process.env.INTEGRATION_SUPABASE_ANON_KEY;
const SERVICE = process.env.INTEGRATION_SUPABASE_SERVICE_ROLE_KEY;
const configured = Boolean(URL && ANON && SERVICE);
const options = { auth: { persistSession: false, autoRefreshToken: false } } as const;
const PASSWORD = "correct horse battery staple";
const run = Date.now().toString(36);

describe.skipIf(!configured)("accounts (real API)", () => {
  let service: SupabaseClient;

  async function parent(label: string) {
    const db = createClient(URL!, ANON!, options);
    const { data, error } = await db.auth.signUp({
      email: `${label}-${run}@example.test`,
      password: PASSWORD,
    });
    if (error || !data.user) throw error ?? new Error("sign-up failed");
    return { id: data.user.id, email: `${label}-${run}@example.test` };
  }

  async function learner(parentId: string, username: string) {
    const result = await provisionLearner(createSupabaseProvisioningPorts(), parentId, {
      displayName: "Child",
      username,
      password: PASSWORD,
      grade: 5,
    });
    if (!result.ok) throw new Error(`could not make ${username}: ${result.error}`);
    // something saved about the child, in the places that matter most
    const session = await service
      .from("tutor_sessions")
      .insert({ learner_id: result.learnerId, objective_id: "G5-OPS-ADDITION-WHOLE-NUMBERS-001" })
      .select("id")
      .single();
    if (session.error) throw session.error;
    const message = await service.from("tutor_messages").insert({
      session_id: session.data.id,
      learner_id: result.learnerId,
      role: "learner",
      kind: "LEARNER_MESSAGE",
      content: "why do we carry the one?",
    });
    if (message.error) throw message.error;
    return { id: result.learnerId, username };
  }

  const canSignIn = async (email: string, password = PASSWORD) => {
    const { data, error } = await createClient(URL!, ANON!, options).auth.signInWithPassword({
      email,
      password,
    });
    return !error && Boolean(data.session);
  };

  const rowsFor = async (learnerId: string) => {
    const counts: Record<string, number> = {};
    for (const [table, column] of [
      ["profiles", "id"],
      ["learner_profiles", "profile_id"],
      ["guardianships", "learner_id"],
      ["tutor_sessions", "learner_id"],
      ["tutor_messages", "learner_id"],
    ] as const) {
      const { count, error } = await service
        .from(table)
        .select("*", { count: "exact", head: true })
        .eq(column, learnerId);
      if (error) throw error;
      counts[table] = count ?? 0;
    }
    return counts;
  };

  beforeAll(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = URL;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = ANON;
    process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE;
    service = createClient(URL!, SERVICE!, options);
  });

  it("deletes a child's account for their guardian: nobody can sign in as them, and nothing is left", async () => {
    const mum = await parent("acc-mum");
    const child = await learner(mum.id, `ac${run}a`.slice(0, 24));
    expect(await canSignIn(learnerEmail(child.username))).toBe(true);
    expect(Object.values(await rowsFor(child.id)).every((n) => n >= 1)).toBe(true);

    const ports = createSupabaseAccountPorts();
    expect(await removeLearner(ports, mum.id, child.id)).toEqual({ ok: true });

    expect(await canSignIn(learnerEmail(child.username))).toBe(false);
    expect(await rowsFor(child.id)).toEqual({
      profiles: 0,
      learner_profiles: 0,
      guardianships: 0,
      tutor_sessions: 0,
      tutor_messages: 0,
    });
    const gone = await service.auth.admin.getUserById(child.id);
    expect(gone.data.user).toBeNull();
    // the parent is untouched
    expect(await canSignIn(mum.email)).toBe(true);
    // and the username can be used again
    const again = await learner(mum.id, child.username);
    expect(again.id).not.toBe(child.id);
  });

  it("does nothing, and says the child is not there, for anyone who is not a guardian", async () => {
    const mum = await parent("acc-owner");
    const stranger = await parent("acc-stranger");
    const child = await learner(mum.id, `ac${run}b`.slice(0, 24));
    const ports = createSupabaseAccountPorts();
    expect(await removeLearner(ports, stranger.id, child.id)).toEqual({
      ok: false,
      error: "NOT_FOUND",
    });
    // a parent's own id is not a child to delete
    expect(await removeLearner(ports, mum.id, mum.id)).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(await canSignIn(learnerEmail(child.username))).toBe(true);
    expect(await canSignIn(mum.email)).toBe(true);
    expect((await rowsFor(child.id)).tutor_messages).toBe(1);
  });

  it("changes a child's password for their guardian only", async () => {
    const mum = await parent("acc-pw");
    const stranger = await parent("acc-pw-stranger");
    const child = await learner(mum.id, `ac${run}c`.slice(0, 24));
    const ports = createSupabaseAccountPorts();
    const email = learnerEmail(child.username);
    const newPassword = "a different long password";

    expect(await changeLearnerPassword(ports, stranger.id, child.id, newPassword)).toEqual({
      ok: false,
      error: "NOT_FOUND",
    });
    expect(await canSignIn(email)).toBe(true);

    expect(await changeLearnerPassword(ports, mum.id, child.id, newPassword)).toEqual({
      ok: true,
      username: child.username,
    });
    expect(await canSignIn(email, PASSWORD)).toBe(false);
    expect(await canSignIn(email, newPassword)).toBe(true);
  });

  it("deletes a family: the parent and the children they alone look after, and not a shared child", async () => {
    const mum = await parent("acc-fam-mum");
    const dad = await parent("acc-fam-dad");
    const mine = await learner(mum.id, `ac${run}d`.slice(0, 24));
    const shared = await learner(mum.id, `ac${run}e`.slice(0, 24));
    const guard = await service
      .from("guardianships")
      .insert({ parent_id: dad.id, learner_id: shared.id });
    if (guard.error) throw guard.error;
    const bystander = await learner(dad.id, `ac${run}f`.slice(0, 24));

    const ports = createSupabaseAccountPorts();
    expect(await removeFamily(ports, mum.id)).toEqual({ ok: true, learnersRemoved: 1 });

    expect(await canSignIn(mum.email)).toBe(false);
    expect(await canSignIn(learnerEmail(mine.username))).toBe(false);
    expect((await rowsFor(mine.id)).tutor_sessions).toBe(0);
    // the child with another guardian stays, with that guardian, and keeps their work
    expect(await canSignIn(learnerEmail(shared.username))).toBe(true);
    expect(await rowsFor(shared.id)).toMatchObject({ guardianships: 1, tutor_sessions: 1 });
    // another family is untouched
    expect(await canSignIn(dad.email)).toBe(true);
    expect(await canSignIn(learnerEmail(bystander.username))).toBe(true);
  });
});

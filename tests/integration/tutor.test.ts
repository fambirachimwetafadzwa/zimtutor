import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { learnerEmail } from "../../src/lib/auth/credentials";
import { provisionLearner } from "../../src/lib/auth/learners";
import { createSupabaseProvisioningPorts } from "../../src/lib/auth/learners.server";
import { SupabaseBankStore, getQuestionKey } from "../../src/lib/questions/bank";
import { act, startOrResume, type TutorDeps } from "../../src/lib/tutor/service";
import { SupabaseCurriculumPort } from "../../src/lib/tutor/supabase-curriculum";
import { SupabaseTutorStore } from "../../src/lib/tutor/supabase-store";
import { createVoice } from "../../src/lib/tutor/voice";

/**
 * The tutor through the real API (PostgREST + GoTrue): the Supabase store and curriculum port, the
 * database function that commits a step, and who can read what a child said.
 */

const URL = process.env.INTEGRATION_SUPABASE_URL;
const ANON = process.env.INTEGRATION_SUPABASE_ANON_KEY;
const SERVICE = process.env.INTEGRATION_SUPABASE_SERVICE_ROLE_KEY;
const configured = Boolean(URL && ANON && SERVICE);
const options = { auth: { persistSession: false, autoRefreshToken: false } } as const;
const PASSWORD = "correct horse battery staple";
const run = Date.now().toString(36);
const GOAL = "G5-OPS-ADDITION-WHOLE-NUMBERS-001";

describe.skipIf(!configured)("the tutor (real API)", () => {
  let service: SupabaseClient;
  let parent: { id: string; db: SupabaseClient };
  let otherParent: { id: string; db: SupabaseClient };
  let learner: { id: string; db: SupabaseClient };
  let deps: TutorDeps;

  async function signUp(label: string) {
    const db = createClient(URL!, ANON!, options);
    const { data, error } = await db.auth.signUp({
      email: `${label}-${run}@example.test`,
      password: PASSWORD,
    });
    if (error || !data.user) throw error ?? new Error("sign-up failed");
    return { id: data.user.id, db };
  }

  beforeAll(async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = URL;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = ANON;
    process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE;
    service = createClient(URL!, SERVICE!, options);
    parent = await signUp("tutor-parent");
    otherParent = await signUp("tutor-other");
    const username = `tom${run}`;
    const result = await provisionLearner(createSupabaseProvisioningPorts(), parent.id, {
      displayName: "Tom",
      username,
      password: PASSWORD,
      grade: 5,
    });
    if (!result.ok) throw new Error(result.error);
    const db = createClient(URL!, ANON!, options);
    const { data } = await db.auth.signInWithPassword({
      email: learnerEmail(username),
      password: PASSWORD,
    });
    learner = { id: data.user!.id, db };
    deps = {
      store: new SupabaseTutorStore(service),
      bank: new SupabaseBankStore(service),
      curriculum: new SupabaseCurriculumPort(service),
      voice: createVoice(),
    };
  }, 60_000);

  let sessionId = "";

  it("opens a lesson with the syllabus's own words, read from the database", async () => {
    const view = await startOrResume(deps, { learnerId: learner.id, objectiveId: GOAL });
    sessionId = view.sessionId;
    expect(view).toMatchObject({ status: "ACTIVE", phase: "LESSON" });

    const { data: objective } = await service
      .from("learning_objectives")
      .select("text")
      .eq("id", GOAL)
      .single();
    expect(view.objective.text).toBe(objective!.text);
    const identify = view.messages[0]!;
    expect(identify.quotes[0]!.items).toEqual([objective!.text]);
    // the citation names the source document and a page
    expect(identify.citation).toMatch(/Junior Mathematics Syllabus.*, page \d+/);
  });

  it("explains with the Content and Activities columns of the syllabus row", async () => {
    const view = await act(deps, {
      learnerId: learner.id,
      sessionId,
      action: { type: "CONTINUE" },
    });
    const explain = view.messages.find((m) => m.kind === "EXPLAIN")!;
    const { data: row } = await service
      .from("learning_objectives")
      .select("competency_row_id")
      .eq("id", GOAL)
      .single();
    const { data: content } = await service
      .from("curriculum_content")
      .select("text")
      .eq("competency_row_id", row!.competency_row_id)
      .order("ordinal");
    expect(explain.quotes[0]!.items).toEqual(content!.map((c) => c.text));
    expect(view.mastery).toMatchObject({ state: "INTRODUCED" });
  });

  it("marks answers, records attempts and mastery together, and moves on", async () => {
    let view = await act(deps, { learnerId: learner.id, sessionId, action: { type: "CONTINUE" } });
    const id = view.openQuestion!.id;
    const key = await getQuestionKey(deps.bank, id);
    view = await act(deps, {
      learnerId: learner.id,
      sessionId,
      action: { type: "ANSWER", questionId: id, answer: key!.display },
    });
    expect(view.phase).toBe("RESOLVED");
    expect(view.progress).toMatchObject({ resolved: 1, firstTry: 1 });

    const { data: attempts } = await service
      .from("question_attempts")
      .select("question_id, attempt_number, is_correct, session_id")
      .eq("session_id", sessionId);
    expect(attempts).toEqual([
      { question_id: id, attempt_number: 1, is_correct: true, session_id: sessionId },
    ]);
    const { data: mastery } = await service
      .from("learner_objective_mastery")
      .select("attempts, correct_attempts, current_state")
      .eq("learner_id", learner.id)
      .eq("objective_id", GOAL)
      .single();
    expect(mastery).toMatchObject({ attempts: 1, correct_attempts: 1 });
    const { count } = await service
      .from("mastery_events")
      .select("*", { count: "exact", head: true })
      .eq("learner_id", learner.id)
      .eq("question_id", id);
    expect(count).toBe(1);
  });

  it("keeps a stale step from being applied twice", async () => {
    const before = await deps.store.getSession(sessionId);
    const view = await act(deps, {
      learnerId: learner.id,
      sessionId,
      action: { type: "NEXT_QUESTION" },
    });
    const id = view.openQuestion!.id;
    const key = await getQuestionKey(deps.bank, id);
    const answer = key!.display;
    await Promise.all(
      [1, 2, 3].map(() =>
        act(deps, {
          learnerId: learner.id,
          sessionId,
          action: { type: "ANSWER", questionId: id, answer },
        }),
      ),
    );
    const { count } = await service
      .from("question_attempts")
      .select("*", { count: "exact", head: true })
      .eq("session_id", sessionId)
      .eq("question_id", id);
    expect(count).toBe(1);
    const after = await deps.store.getSession(sessionId);
    expect(after!.rev).toBeGreaterThan(before!.rev);
  });

  it("lets the learner read their own conversation, the parent see the session but not the words", async () => {
    await act(deps, {
      learnerId: learner.id,
      sessionId,
      action: { type: "ASK", text: "my number is 0771234567" },
    });
    const own = await learner.db
      .from("tutor_messages")
      .select("kind, content, flagged")
      .eq("session_id", sessionId)
      .order("seq");
    expect(own.error).toBeNull();
    expect(own.data!.length).toBeGreaterThan(5);
    expect(JSON.stringify(own.data)).not.toContain("0771234567");
    expect(own.data!.some((m) => m.flagged && m.content.includes("[removed]"))).toBe(true);

    const sessionAsParent = await parent.db
      .from("tutor_sessions")
      .select("id, summary")
      .eq("id", sessionId);
    expect(sessionAsParent.data).toHaveLength(1);
    const messagesAsParent = await parent.db
      .from("tutor_messages")
      .select("content")
      .eq("session_id", sessionId);
    expect(messagesAsParent.data).toEqual([]);

    const sessionAsStranger = await otherParent.db
      .from("tutor_sessions")
      .select("id")
      .eq("id", sessionId);
    expect(sessionAsStranger.data).toEqual([]);
  });

  it("lets no client write a lesson or call the commit function", async () => {
    const forged = await learner.db.from("tutor_messages").insert({
      session_id: sessionId,
      learner_id: learner.id,
      role: "learner",
      kind: "LEARNER_MESSAGE",
      content: "forged",
    });
    expect(forged.error).not.toBeNull();
    const update = await learner.db
      .from("tutor_sessions")
      .update({ status: "COMPLETED" })
      .eq("id", sessionId);
    expect(update.data ?? []).toEqual([]);
    const session = await deps.store.getSession(sessionId);
    expect(session!.status).toBe("ACTIVE");
    const call = await learner.db.rpc("tutor_commit", {
      p_session_id: sessionId,
      p_expected_rev: session!.rev,
      p_phase: "ENDED",
      p_state: session!.state,
      p_status: "COMPLETED",
      p_summary: null,
      p_messages: [],
      p_attempt: null,
      p_mastery: null,
    });
    expect(call.error).not.toBeNull();
    expect((await deps.store.getSession(sessionId))!.status).toBe("ACTIVE");
  });

  it("belongs to its learner: nobody else can act in it", async () => {
    await expect(
      act(deps, { learnerId: parent.id, sessionId, action: { type: "END" } }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const view = await act(deps, { learnerId: learner.id, sessionId, action: { type: "END" } });
    expect(view).toMatchObject({ status: "COMPLETED", phase: "ENDED" });
    const { data } = await service
      .from("tutor_sessions")
      .select("summary")
      .eq("id", sessionId)
      .single();
    expect(data!.summary).toMatchObject({ objectiveId: GOAL, endedBy: "LEARNER" });
  });
});

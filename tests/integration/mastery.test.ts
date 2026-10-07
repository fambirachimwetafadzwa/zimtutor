import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { learnerEmail } from "../../src/lib/auth/credentials";
import { provisionLearner } from "../../src/lib/auth/learners";
import { createSupabaseProvisioningPorts } from "../../src/lib/auth/learners.server";
import { applyObservation, newMasteryRecord, type Observation } from "../../src/lib/mastery/engine";
import { getMastery, recordIntroduced, recordObservation } from "../../src/lib/mastery/service";

/** Mastery persistence through the real API: atomic under concurrency, and visible only to the right people. */

const URL = process.env.INTEGRATION_SUPABASE_URL;
const ANON = process.env.INTEGRATION_SUPABASE_ANON_KEY;
const SERVICE = process.env.INTEGRATION_SUPABASE_SERVICE_ROLE_KEY;
const configured = Boolean(URL && ANON && SERVICE);
const options = { auth: { persistSession: false, autoRefreshToken: false } } as const;
const PASSWORD = "correct horse battery staple";
const run = Date.now().toString(36);
const OBJECTIVE = "G5-NUM-PROPER-FRACTIONS-004";

const observation = (
  outcome: "CORRECT" | "INCORRECT",
  at: Date,
  extra: Partial<Observation> = {},
): Observation => ({
  outcome,
  difficulty: 1,
  hintsUsed: 0,
  attemptNumber: 1,
  questionType: "NUMERIC",
  at,
  ...extra,
});

describe.skipIf(!configured)("mastery persistence (real API)", () => {
  let service: SupabaseClient;
  let parent: { id: string; db: SupabaseClient };
  let otherParent: { db: SupabaseClient };
  let learner: { id: string; db: SupabaseClient };

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
    parent = await signUp("mastery-parent");
    otherParent = await signUp("mastery-other");
    const username = `mia${run}`;
    const result = await provisionLearner(createSupabaseProvisioningPorts(), parent.id, {
      displayName: "Mia",
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
  }, 60_000);

  it("creates the record on first sight, then applies observations exactly as the engine does", async () => {
    const t0 = new Date("2026-04-01T08:00:00Z");
    const introduced = await recordIntroduced(service, learner.id, OBJECTIVE, t0);
    expect(introduced.currentState).toBe("INTRODUCED");

    let expected = applyObservation(
      introduced,
      observation("CORRECT", new Date(t0.getTime() + 60_000)),
    ).record;
    const first = await recordObservation(service, {
      learnerId: learner.id,
      objectiveId: OBJECTIVE,
      observation: observation("CORRECT", new Date(t0.getTime() + 60_000)),
    });
    expect(first.record).toEqual(expected);

    expected = applyObservation(
      expected,
      observation("INCORRECT", new Date(t0.getTime() + 120_000), {
        difficulty: expected.difficulty,
      }),
    ).record;
    const second = await recordObservation(service, {
      learnerId: learner.id,
      objectiveId: OBJECTIVE,
      observation: observation("INCORRECT", new Date(t0.getTime() + 120_000), {
        difficulty: first.record.difficulty,
      }),
    });
    expect(second.record).toEqual(expected);

    const stored = (await getMastery(service, learner.id, [OBJECTIVE])).get(OBJECTIVE)!;
    expect(stored.attempts).toBe(2);
    expect(stored.masteryScore).toBeCloseTo(expected.masteryScore, 4);
    expect(stored.recentOutcomes).toEqual([true, false]);
    expect(stored.lastAttemptAt?.toISOString()).toBe(
      new Date(t0.getTime() + 120_000).toISOString(),
    );
  });

  it("keeps an append-only history with before/after and the reason", async () => {
    const { data } = await service
      .from("mastery_events")
      .select("evidence, score_before, score_after, state_before, state_after, reason")
      .eq("learner_id", learner.id)
      .eq("objective_id", OBJECTIVE)
      .order("created_at");
    expect(data).toHaveLength(2);
    expect(data![0]).toMatchObject({ evidence: 1, state_before: "INTRODUCED" });
    expect(data![1]).toMatchObject({ evidence: 0 });
    expect(data![1]!.score_after).toBeLessThan(data![1]!.score_before);
    expect(data![0]!.reason).toContain("correct without help");
  });

  it("applies simultaneous answers one after the other, losing none", async () => {
    const objective = "G5-NUM-PROPER-FRACTIONS-002";
    const at = new Date("2026-04-02T08:00:00Z");
    await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        recordObservation(service, {
          learnerId: learner.id,
          objectiveId: objective,
          observation: observation("CORRECT", new Date(at.getTime() + i * 1000)),
        }),
      ),
    );
    const stored = (await getMastery(service, learner.id, [objective])).get(objective)!;
    expect(stored.attempts).toBe(6);
    expect(stored.correctAttempts).toBe(6);
    const { count } = await service
      .from("mastery_events")
      .select("id", { count: "exact", head: true })
      .eq("learner_id", learner.id)
      .eq("objective_id", objective);
    expect(count).toBe(6);
  });

  it("lets the learner and their parent read the records — and nobody else", async () => {
    expect((await getMastery(learner.db, learner.id)).has(OBJECTIVE)).toBe(true);
    expect((await getMastery(parent.db, learner.id)).has(OBJECTIVE)).toBe(true);
    expect((await getMastery(otherParent.db, learner.id)).size).toBe(0);
    const { data } = await otherParent.db
      .from("mastery_events")
      .select("id")
      .eq("learner_id", learner.id);
    expect(data ?? []).toHaveLength(0);
  });

  it("refuses to let the learner write their own mastery", async () => {
    const forged = await learner.db
      .from("learner_objective_mastery")
      .update({ mastery_score: 1, current_state: "MASTERED" })
      .eq("learner_id", learner.id)
      .eq("objective_id", OBJECTIVE)
      .select();
    expect(forged.data ?? []).toHaveLength(0);
    expect(
      (await getMastery(service, learner.id, [OBJECTIVE])).get(OBJECTIVE)!.currentState,
    ).not.toBe("MASTERED");
    const insert = await learner.db
      .from("mastery_events")
      .insert({
        learner_id: learner.id,
        objective_id: OBJECTIVE,
        evidence: 1,
        score_before: 0,
        score_after: 1,
        state_before: "NOT_STARTED",
        state_after: "MASTERED",
      });
    expect(insert.error).not.toBeNull();
  });

  it("matches a fresh engine run for a whole history (the engine is the only authority)", async () => {
    const objective = "G5-NUM-PROPER-FRACTIONS-003";
    const outcomes: Array<"CORRECT" | "INCORRECT"> = [
      "CORRECT",
      "CORRECT",
      "INCORRECT",
      "CORRECT",
      "CORRECT",
      "CORRECT",
      "CORRECT",
    ];
    let expected = newMasteryRecord(new Date("2026-05-01T08:00:00Z"));
    for (const [i, outcome] of outcomes.entries()) {
      const at = new Date(Date.UTC(2026, 4, 1 + i, 8));
      const o = observation(outcome, at, { difficulty: expected.difficulty });
      expected = applyObservation(expected, o).record;
      await recordObservation(service, {
        learnerId: learner.id,
        objectiveId: objective,
        observation: o,
      });
    }
    const stored = (await getMastery(service, learner.id, [objective])).get(objective)!;
    expect(stored.currentState).toBe(expected.currentState);
    expect(stored.masteryScore).toBeCloseTo(expected.masteryScore, 4);
    expect(stored.difficulty).toBe(expected.difficulty);
    expect(stored.hardCorrect).toBe(expected.hardCorrect);
  });
});

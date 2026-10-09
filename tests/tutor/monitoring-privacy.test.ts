import { describe, expect, it } from "vitest";
import { createMonitor } from "../../src/lib/monitoring/monitor";
import type { AnalyticsReport, ErrorReport } from "../../src/lib/monitoring/reporters";
import { Throttle } from "../../src/lib/monitoring/throttle";
import { analyticsForTutor } from "../../src/lib/tutor/analytics";
import { act, startOrResume, type TutorDeps } from "../../src/lib/tutor/service";
import { createVoice } from "../../src/lib/tutor/voice";
import { MemoryBankStore } from "../questions/memory-store";
import { FixtureCurriculum, rightAnswer } from "./learner";
import { MemoryTutorStore } from "./memory-store";

const GOAL = "G5-OPS-ADDITION-WHOLE-NUMBERS-001";

/**
 * A whole lesson, in which a child writes their name, number, address and email, with a monitor
 * attached to everything the tutor reports. What reaches the monitor's reporters is read as the
 * service that receives it would read it: as text. Nothing the child wrote may be in it.
 */
describe("what is reported about a lesson in which a child writes personal details", () => {
  const WRITTEN =
    "my name is Chipo Moyo, my number is 0771234567, I live at 14 Samora Machel Avenue Harare, email chipo.moyo@example.test";
  const FRAGMENTS = [
    "Chipo",
    "Moyo",
    "0771234567",
    "Samora",
    "Harare",
    "chipo.moyo",
    "example.test",
  ];

  it("carries counts and kinds only", async () => {
    const reported: Array<ErrorReport | AnalyticsReport> = [];
    const monitor = createMonitor({
      reporters: [
        {
          name: "recorder",
          error: async (r) => void reported.push(r),
          analytics: async (r) => void reported.push(r),
        },
      ],
      throttle: new Throttle({ perKey: 100, total: 1000, windowMs: 60_000 }),
    });

    const bank = new MemoryBankStore();
    const store = new MemoryTutorStore(bank, () => new Date("2026-10-08T08:00:00Z"));
    let n = 0;
    const pending: Promise<void>[] = [];
    const deps: TutorDeps = {
      store,
      bank,
      curriculum: new FixtureCurriculum(),
      voice: createVoice({}),
      now: () => new Date("2026-10-08T08:00:00Z"),
      seed: () => `seed-${++n}`,
      onEvent: (event) => {
        const counted = analyticsForTutor(event);
        if (counted) pending.push(monitor.track(counted));
      },
    };

    let view = await startOrResume(deps, { learnerId: "learner-1", objectiveId: GOAL });
    const step = (action: Parameters<typeof act>[1]["action"]) =>
      act(deps, { learnerId: "learner-1", sessionId: view.sessionId, action });
    view = await step({ type: "CONTINUE" });
    view = await step({ type: "CONTINUE" });
    view = await step({ type: "ASK", text: WRITTEN });
    const open = view.openQuestion!.id;
    view = await step({ type: "ANSWER", questionId: open, answer: await rightAnswer(bank, open) });
    view = await step({ type: "END" });
    await Promise.all(pending);

    // the lesson did what it should, so the test is looking at something real
    expect(view.status).not.toBe("ACTIVE");
    expect(reported.map((r) => ("name" in r ? r.name : r.event))).toEqual([
      "lesson_started",
      "message_flagged",
      "lesson_finished",
    ]);

    const text = JSON.stringify(reported);
    for (const fragment of FRAGMENTS) expect(text, fragment).not.toContain(fragment);
    // only what was meant to be there
    expect(reported[0]).toMatchObject({
      name: "lesson_started",
      properties: { grade: 5, mode: "LEARN" },
    });
    expect(reported[1]).toMatchObject({
      name: "message_flagged",
      properties: { kind: expect.stringContaining("PERSONAL_INFO") },
    });
    expect(reported[2]).toMatchObject({
      name: "lesson_finished",
      properties: { resolved: 1, firstTry: 1 },
    });
  });
});

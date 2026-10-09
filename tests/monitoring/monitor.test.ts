import { describe, expect, it } from "vitest";
import { createMonitor } from "../../src/lib/monitoring/monitor";
import {
  ReporterFailure,
  type AnalyticsReport,
  type ErrorReport,
  type Reporter,
} from "../../src/lib/monitoring/reporters";
import { Throttle } from "../../src/lib/monitoring/throttle";

function setup(overrides: Partial<Reporter> = {}) {
  const errors: ErrorReport[] = [];
  const counts: AnalyticsReport[] = [];
  const failures: Array<{ reporter: string; status?: number }> = [];
  const reporter: Reporter = {
    name: "test",
    error: async (r) => void errors.push(r),
    analytics: async (r) => void counts.push(r),
    ...overrides,
  };
  const monitor = createMonitor({
    reporters: [reporter],
    throttle: new Throttle({ perKey: 3, total: 50, windowMs: 60_000 }),
    now: () => new Date("2026-10-08T12:00:00Z"),
    onFailure: (name, status) => failures.push({ reporter: name, ...(status ? { status } : {}) }),
  });
  return { monitor, errors, counts, failures };
}

describe("the monitor", () => {
  it("does nothing at all when there is nowhere to report to", async () => {
    const monitor = createMonitor({
      reporters: [],
      throttle: new Throttle({ perKey: 3, total: 5, windowMs: 1000 }),
    });
    await expect(monitor.error("x", new Error("boom"))).resolves.toBeUndefined();
    await expect(
      monitor.track({ name: "limit_reached", bucket: "tutor.ask" }),
    ).resolves.toBeUndefined();
  });

  describe("a fault", () => {
    it("reaches the reporter scrubbed: what was in the message is not", async () => {
      const { monitor, errors } = setup();
      const error = Object.assign(
        new Error(
          "no row for chipo@example.test or 0771234567 (learner 3f2b8c1e-7d4a-4b9e-a1c2-0123456789ab)",
        ),
        {
          code: "PT409",
          details: "Key (username)=(chipo) already exists",
          cause: new Error("my name is Chipo"),
        },
      );
      await monitor.error("tutor_action_failed", error, {
        bucket: "tutor.ask",
        learnerId: "3f2b8c1e-7d4a-4b9e-a1c2-0123456789ab",
        text: "why do we carry the one",
        email: "a@b.co",
      });
      expect(errors).toHaveLength(1);
      const sent = JSON.stringify(errors[0]);
      for (const secret of [
        "chipo",
        "Chipo",
        "example.test",
        "0771234567",
        "3f2b8c1e",
        "carry the one",
        "a@b.co",
        "Key (username)",
      ])
        expect(sent, secret).not.toContain(secret);
      expect(errors[0]).toMatchObject({
        event: "tutor_action_failed",
        error: {
          name: "Error",
          message: "no row for [email] or [number] (learner [id])",
          code: "PT409",
        },
        fields: { bucket: "tutor.ask" },
      });
    });

    it("keeps only a route's template, never the address that was asked for", async () => {
      const { monitor, errors } = setup();
      await monitor.error("request_error", new Error("x"), {
        route: "/student/learn/[objectiveId]?next=/a&who=chipo",
      });
      expect(errors[0]!.fields.route).toBe("/student/learn/[objectiveId]");
    });

    it("gives a name that is not a name a plain one", async () => {
      const { monitor, errors } = setup();
      await monitor.error("Chipo's lesson 0771234567", new Error("x"));
      expect(errors[0]!.event).toBe("error");
    });

    it("tells the same fault only a few times in a minute", async () => {
      const { monitor, errors } = setup();
      for (let i = 0; i < 20; i++) await monitor.error("same_fault", new Error("same message"));
      expect(errors).toHaveLength(3);
      await monitor.error("another_fault", new Error("same message"));
      expect(errors).toHaveLength(4);
    });

    it("is not told to a reporter that only counts", async () => {
      const { monitor, counts } = setup({ error: undefined });
      await monitor.error("x", new Error("boom"));
      expect(counts).toHaveLength(0);
    });
  });

  describe("a count", () => {
    it("carries only its listed facts", async () => {
      const { monitor, counts } = setup();
      await monitor.track({ name: "lesson_finished", resolved: 6, firstTry: 4 });
      await monitor.track({
        name: "paper_finished",
        paper: 1,
        length: "SHORT",
        answered: 13,
        of: 20,
      });
      await monitor.track({ name: "limit_reached", bucket: "login.account" });
      expect(counts.map((c) => [c.name, c.properties])).toEqual([
        ["lesson_finished", { resolved: 6, firstTry: 4 }],
        ["paper_finished", { paper: 1, length: "SHORT", answered: 13, of: 20 }],
        ["limit_reached", { bucket: "login.account" }],
      ]);
    });

    it("drops anything that is not on the list, even if a caller adds it", async () => {
      const { monitor, counts } = setup();
      await monitor.track({
        name: "lesson_finished",
        resolved: 1,
        firstTry: 1,
        learnerId: "3f2b8c1e-7d4a-4b9e-a1c2-0123456789ab",
        email: "a@b.co",
        text: "why do we carry",
      } as never);
      expect(JSON.stringify(counts[0])).not.toMatch(/3f2b8c1e|a@b\.co|carry|learnerId|email|text/);
    });

    it("is not sent to a reporter that only takes faults", async () => {
      const { monitor, errors } = setup({ analytics: undefined });
      await monitor.track({ name: "limit_reached", bucket: "x" });
      expect(errors).toHaveLength(0);
    });
  });

  describe("when a reporter fails", () => {
    it("carries on, and says which reporter and what status, nothing more", async () => {
      const { monitor, failures } = setup({
        error: async () => {
          throw new ReporterFailure("test", 403);
        },
        analytics: async () => {
          throw new Error("connect failed: the child chipo@example.test said 0771234567");
        },
      });
      await expect(monitor.error("x", new Error("boom"))).resolves.toBeUndefined();
      await expect(monitor.track({ name: "limit_reached", bucket: "x" })).resolves.toBeUndefined();
      expect(failures).toEqual([{ reporter: "test", status: 403 }, { reporter: "test" }]);
      expect(JSON.stringify(failures)).not.toMatch(/chipo|0771234567/);
    });

    it("does not fail when saying so fails", async () => {
      const monitor = createMonitor({
        reporters: [
          {
            name: "test",
            error: async () => {
              throw new Error("x");
            },
          },
        ],
        throttle: new Throttle({ perKey: 3, total: 5, windowMs: 1000 }),
        onFailure: () => {
          throw new Error("the log is full");
        },
      });
      await expect(monitor.error("x", new Error("boom"))).resolves.toBeUndefined();
    });

    it("lets the other reporters through", async () => {
      const seen: string[] = [];
      const monitor = createMonitor({
        reporters: [
          {
            name: "bad",
            error: async () => {
              throw new ReporterFailure("bad", 500);
            },
          },
          { name: "good", error: async () => void seen.push("good") },
        ],
        throttle: new Throttle({ perKey: 3, total: 5, windowMs: 1000 }),
      });
      await monitor.error("x", new Error("boom"));
      expect(seen).toEqual(["good"]);
    });
  });
});

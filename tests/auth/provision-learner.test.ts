import { describe, expect, it, vi } from "vitest";
import { PortError, provisionLearner, type LearnerProvisioningPorts } from "@/lib/auth/learners";
import { MAX_LEARNERS_PER_PARENT } from "@/lib/auth/credentials";

const input = { displayName: "Tendai", username: "tendai7", password: "blue mango tree", grade: 4 };

function ports(overrides: Partial<LearnerProvisioningPorts> = {}) {
  const fake = {
    createAuthUser: vi.fn(async () => ({ id: "learner-1" })),
    deleteAuthUser: vi.fn(async () => {}),
    provisionProfile: vi.fn(async () => {}),
    ...overrides,
  } satisfies LearnerProvisioningPorts;
  return fake;
}

describe("provisionLearner", () => {
  it("creates the identity with a synthetic email, then the profile, for the authenticated parent", async () => {
    const p = ports();
    const result = await provisionLearner(p, "parent-1", input);
    expect(result).toEqual({ ok: true, learnerId: "learner-1", username: "tendai7" });
    expect(p.createAuthUser).toHaveBeenCalledWith({
      email: "tendai7@learners.zimtutor.invalid",
      password: "blue mango tree",
      displayName: "Tendai",
    });
    expect(p.provisionProfile).toHaveBeenCalledWith({
      learnerId: "learner-1",
      parentId: "parent-1",
      grade: 4,
      username: "tendai7",
      maxLearners: MAX_LEARNERS_PER_PARENT,
    });
    expect(p.deleteAuthUser).not.toHaveBeenCalled();
  });

  it("reports a taken username without touching the database", async () => {
    const p = ports({
      createAuthUser: vi.fn(async () => {
        throw new PortError("USER_EXISTS");
      }),
    });
    expect(await provisionLearner(p, "parent-1", input)).toEqual({
      ok: false,
      error: "USERNAME_TAKEN",
    });
    expect(p.provisionProfile).not.toHaveBeenCalled();
    expect(p.deleteAuthUser).not.toHaveBeenCalled();
  });

  it("deletes the new sign-in identity if the profile cannot be created (no orphans)", async () => {
    const p = ports({
      provisionProfile: vi.fn(async () => {
        throw new Error("connection reset");
      }),
    });
    expect(await provisionLearner(p, "parent-1", input)).toEqual({ ok: false, error: "UNKNOWN" });
    expect(p.deleteAuthUser).toHaveBeenCalledExactlyOnceWith("learner-1");
  });

  it("maps the learner limit and cleans up", async () => {
    const p = ports({
      provisionProfile: vi.fn(async () => {
        throw new PortError("LEARNER_LIMIT_REACHED");
      }),
    });
    expect(await provisionLearner(p, "parent-1", input)).toEqual({
      ok: false,
      error: "LEARNER_LIMIT_REACHED",
    });
    expect(p.deleteAuthUser).toHaveBeenCalledWith("learner-1");
  });

  it("maps a username collision detected by the database and cleans up", async () => {
    const p = ports({
      provisionProfile: vi.fn(async () => {
        throw new PortError("USERNAME_TAKEN");
      }),
    });
    expect(await provisionLearner(p, "parent-1", input)).toEqual({
      ok: false,
      error: "USERNAME_TAKEN",
    });
    expect(p.deleteAuthUser).toHaveBeenCalledWith("learner-1");
  });

  it("reports (but does not mask the original error with) a failed cleanup", async () => {
    const cleanupFailure = new Error("auth api down");
    const p = ports({
      provisionProfile: vi.fn(async () => {
        throw new PortError("LEARNER_LIMIT_REACHED");
      }),
      deleteAuthUser: vi.fn(async () => {
        throw cleanupFailure;
      }),
    });
    const onFailure = vi.fn();
    expect(await provisionLearner(p, "parent-1", input, onFailure)).toEqual({
      ok: false,
      error: "LEARNER_LIMIT_REACHED",
    });
    expect(onFailure).toHaveBeenCalledWith("learner-1", cleanupFailure);
  });

  it("returns UNKNOWN (never throws) when identity creation fails unexpectedly", async () => {
    const p = ports({
      createAuthUser: vi.fn(async () => {
        throw new Error("boom");
      }),
    });
    expect(await provisionLearner(p, "parent-1", input)).toEqual({ ok: false, error: "UNKNOWN" });
    expect(p.provisionProfile).not.toHaveBeenCalled();
  });
});

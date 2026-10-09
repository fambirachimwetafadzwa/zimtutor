import { describe, expect, it } from "vitest";
import {
  changeLearnerPassword,
  removeFamily,
  removeLearner,
  type AccountPorts,
} from "../../src/lib/auth/accounts";

/** A small world of parents, learners and who guards whom, with a record of what was done to it. */
function world(
  guardianships: Array<[parent: string, learner: string]>,
  options: { failDeleteOf?: string; failPassword?: boolean } = {},
) {
  const deleted: string[] = [];
  const passwords: Array<[string, string]> = [];
  const ports: AccountPorts = {
    isGuardian: async (parent, learner) =>
      guardianships.some(([p, l]) => p === parent && l === learner),
    guardedLearners: async (parent) =>
      guardianships
        .filter(([p]) => p === parent)
        .map(([, learner]) => ({
          learnerId: learner,
          guardians: guardianships.filter(([, l]) => l === learner).length,
        })),
    learnerUsername: async (learner) => (learner.startsWith("child") ? `user-${learner}` : null),
    deleteAuthUser: async (id) => {
      if (id === options.failDeleteOf) throw new Error("the auth service is down");
      deleted.push(id);
    },
    setPassword: async (id, password) => {
      if (options.failPassword) throw new Error("the auth service is down");
      passwords.push([id, password]);
    },
  };
  return { ports, deleted, passwords };
}

describe("removing a learner", () => {
  it("deletes the account of a child, for one of their guardians", async () => {
    const w = world([["mum", "child-1"]]);
    expect(await removeLearner(w.ports, "mum", "child-1")).toEqual({ ok: true });
    expect(w.deleted).toEqual(["child-1"]);
  });

  it("does nothing, and says the child is not there, for anyone else", async () => {
    const w = world([
      ["mum", "child-1"],
      ["aunt", "child-2"],
    ]);
    expect(await removeLearner(w.ports, "aunt", "child-1")).toEqual({
      ok: false,
      error: "NOT_FOUND",
    });
    expect(await removeLearner(w.ports, "stranger", "child-1")).toEqual({
      ok: false,
      error: "NOT_FOUND",
    });
    // a child who does not exist looks exactly like one who is somebody else's
    expect(await removeLearner(w.ports, "mum", "no-such-child")).toEqual({
      ok: false,
      error: "NOT_FOUND",
    });
    expect(w.deleted).toEqual([]);
  });

  it("does not delete a parent this way, even the parent's own id", async () => {
    const w = world([["mum", "child-1"]]);
    expect(await removeLearner(w.ports, "mum", "mum")).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(w.deleted).toEqual([]);
  });

  it("says it failed, and no more, when the service cannot delete", async () => {
    const w = world([["mum", "child-1"]], { failDeleteOf: "child-1" });
    expect(await removeLearner(w.ports, "mum", "child-1")).toEqual({ ok: false, error: "FAILED" });
  });
});

describe("removing a family", () => {
  it("deletes each child the parent alone guards, then the parent", async () => {
    const w = world([
      ["mum", "child-1"],
      ["mum", "child-2"],
      ["aunt", "child-3"],
    ]);
    expect(await removeFamily(w.ports, "mum")).toEqual({ ok: true, learnersRemoved: 2 });
    expect(w.deleted).toEqual(["child-1", "child-2", "mum"]);
  });

  it("leaves a child who has another guardian, and still deletes the parent", async () => {
    const w = world([
      ["mum", "child-1"],
      ["dad", "child-1"],
      ["mum", "child-2"],
    ]);
    expect(await removeFamily(w.ports, "mum")).toEqual({ ok: true, learnersRemoved: 1 });
    expect(w.deleted).toEqual(["child-2", "mum"]);
  });

  it("deletes a parent who has no children", async () => {
    const w = world([]);
    expect(await removeFamily(w.ports, "mum")).toEqual({ ok: true, learnersRemoved: 0 });
    expect(w.deleted).toEqual(["mum"]);
  });

  it("never touches another family", async () => {
    const w = world([
      ["mum", "child-1"],
      ["aunt", "child-2"],
    ]);
    await removeFamily(w.ports, "mum");
    expect(w.deleted).not.toContain("child-2");
    expect(w.deleted).not.toContain("aunt");
  });

  it("stops before the parent if a child cannot be deleted, so that it can be tried again", async () => {
    const w = world(
      [
        ["mum", "child-1"],
        ["mum", "child-2"],
      ],
      { failDeleteOf: "child-2" },
    );
    expect(await removeFamily(w.ports, "mum")).toEqual({
      ok: false,
      error: "FAILED",
      learnersRemoved: 1,
    });
    expect(w.deleted).toEqual(["child-1"]);
    expect(w.deleted).not.toContain("mum");
  });
});

describe("changing a learner's password", () => {
  it("sets it, for one of their guardians, and says whose it was", async () => {
    const w = world([["mum", "child-1"]]);
    expect(await changeLearnerPassword(w.ports, "mum", "child-1", "a new long password")).toEqual({
      ok: true,
      username: "user-child-1",
    });
    expect(w.passwords).toEqual([["child-1", "a new long password"]]);
  });

  it("changes nothing for anyone else", async () => {
    const w = world([["mum", "child-1"]]);
    expect(await changeLearnerPassword(w.ports, "aunt", "child-1", "a new long password")).toEqual({
      ok: false,
      error: "NOT_FOUND",
    });
    expect(w.passwords).toEqual([]);
  });

  it("says it failed when the service cannot", async () => {
    const w = world([["mum", "child-1"]], { failPassword: true });
    expect(await changeLearnerPassword(w.ports, "mum", "child-1", "a new long password")).toEqual({
      ok: false,
      error: "FAILED",
    });
  });
});

import { describe, expect, it } from "vitest";
import { subjectHash } from "../../src/lib/ratelimit/subject";

describe("what is stored for a thing being counted", () => {
  const secret = "a secret that only the server knows";

  it("is a fixed-size hex hash that does not contain the thing", () => {
    const hash = subjectHash(secret, "login.account", "learner:chipo@learner.zimtutor.invalid");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain("chipo");
  });

  it("is the same for the same thing, however it is cased or spaced at the ends", () => {
    const a = subjectHash(secret, "login.account", "Parent@Example.test");
    expect(subjectHash(secret, "login.account", "parent@example.test")).toBe(a);
    expect(subjectHash(secret, "login.account", "  parent@example.test ")).toBe(a);
  });

  it("differs by bucket, by thing and by secret", () => {
    const base = subjectHash(secret, "login.account", "x");
    expect(subjectHash(secret, "login.address", "x")).not.toBe(base);
    expect(subjectHash(secret, "login.account", "y")).not.toBe(base);
    expect(subjectHash("another secret entirely", "login.account", "x")).not.toBe(base);
  });

  it("cannot be run into another bucket's name", () => {
    // "a.b" + "c" must not equal "a" + "b.c" -- the separator sees to it
    expect(subjectHash(secret, "a.b", "c")).not.toBe(subjectHash(secret, "a", "b.c"));
  });
});

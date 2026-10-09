import { describe, expect, it } from "vitest";
import { BUCKETS, LIMITS, refusalFor, waitPhrase } from "../../src/lib/ratelimit/policy";

describe("the limits", () => {
  it("have names the database accepts, and no colon (the hash joins bucket and subject with one)", () => {
    for (const bucket of BUCKETS) {
      expect(bucket).toMatch(/^[a-z][a-z0-9_.]{1,59}$/);
      expect(bucket).not.toContain(":");
    }
  });

  it("are whole, positive, and no window is longer than a day", () => {
    for (const bucket of BUCKETS) {
      const { max, seconds } = LIMITS[bucket];
      expect(Number.isInteger(max) && max >= 1).toBe(true);
      expect(Number.isInteger(seconds) && seconds >= 1 && seconds <= 24 * 3600).toBe(true);
    }
  });

  it("are far looser for an address than for an account (a network or a school is not one child)", () => {
    expect(LIMITS["login.address"].max).toBeGreaterThanOrEqual(10 * LIMITS["login.account"].max);
    expect(LIMITS["login.account"].max).toBeLessThanOrEqual(10);
  });

  it("allow a child to work as fast as they can press buttons", () => {
    // one press a second, held for a minute, is still within the limit
    expect(LIMITS["tutor.step"].max).toBeGreaterThanOrEqual(60);
    expect(LIMITS["exam.save"].max).toBeGreaterThanOrEqual(60);
  });
});

describe("how long to wait, in words", () => {
  it.each([
    [1, "a few seconds"],
    [10, "a few seconds"],
    [11, "a minute"],
    [90, "a minute"],
    [91, "2 minutes"],
    [600, "10 minutes"],
    [3540, "59 minutes"],
    [3599, "about an hour"],
    [3601, "about 2 hours"],
    [86400, "about 24 hours"],
    [0, "a few seconds"],
    [0.2, "a few seconds"],
  ])("%s seconds is %s", (seconds, phrase) => {
    expect(waitPhrase(seconds)).toBe(phrase);
  });
});

describe("what a person is told", () => {
  it("is a plain sentence for every limit, kind to a child, and names no one", () => {
    for (const bucket of BUCKETS) {
      const text = refusalFor(bucket, 45);
      expect(text.length).toBeGreaterThan(20);
      expect(text).toMatch(/[.!]$/);
      // it never says whose count it was, or how many tries there were
      expect(text).not.toMatch(/\d{2,}|username|@|your account|this account|your address/i);
      expect(text).not.toMatch(/blocked|banned|attack|suspicious|abuse|violat/i);
    }
  });

  it("says how long to wait when waiting is what helps", () => {
    expect(refusalFor("tutor.step", 30)).toContain("a minute");
    expect(refusalFor("login.account", 840)).toContain("14 minutes");
    expect(refusalFor("login.account", 840)).toContain("grown-up");
    expect(refusalFor("exam.start", 1800)).toContain("30 minutes");
    // an hour's wait is not "going a little fast"
    expect(refusalFor("exam.start", 1800)).not.toContain("going a little fast");
    expect(refusalFor("exam.finish", 1800)).not.toContain("going a little fast");
  });
});

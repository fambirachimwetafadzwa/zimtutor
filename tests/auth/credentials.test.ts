import { describe, expect, it } from "vitest";
import {
  createLearnerSchema,
  displayNameSchema,
  emailSchema,
  gradeSchema,
  isLearnerEmail,
  learnerEmail,
  learnerSignInSchema,
  looksLikeContactDetails,
  parentSignUpSchema,
  passwordSchema,
  usernameSchema,
  USERNAME_PATTERN,
} from "@/lib/auth/credentials";

describe("learner identities", () => {
  it("derives a non-deliverable synthetic email from the username", () => {
    expect(learnerEmail("  Tendai ")).toBe("tendai@learners.zimtutor.invalid");
    expect(isLearnerEmail("tendai@learners.zimtutor.invalid")).toBe(true);
    expect(isLearnerEmail("TENDAI@LEARNERS.ZIMTUTOR.INVALID")).toBe(true);
    expect(isLearnerEmail("parent@gmail.com")).toBe(false);
  });

  it("uses a reserved .invalid domain so no message can ever reach a real inbox", () => {
    expect(learnerEmail("x1y")).toMatch(/\.invalid$/);
  });

  it("stops a parent signing up with a learner address", () => {
    expect(emailSchema.safeParse("kid@learners.zimtutor.invalid").success).toBe(false);
    expect(emailSchema.safeParse("Parent@Example.com").data).toBe("parent@example.com");
  });
});

describe("usernames", () => {
  it("normalises to lower case and matches the database CHECK constraint", () => {
    expect(usernameSchema.parse(" Rudo.M ")).toBe("rudo.m");
    for (const ok of ["abc", "a-b", "tendai_9", "9lives", "a".repeat(24)]) {
      expect(USERNAME_PATTERN.test(ok)).toBe(true);
      expect(usernameSchema.safeParse(ok).success).toBe(true);
    }
  });

  it("rejects usernames the database would reject", () => {
    for (const bad of ["ab", "", "a".repeat(25), "-abc", ".abc", "has space", "émile", "a@b", "x;drop"]) {
      expect(usernameSchema.safeParse(bad).success, bad).toBe(false);
    }
  });
});

describe("passwords", () => {
  it("enforces length and rejects very common passwords", () => {
    expect(passwordSchema.safeParse("short").success).toBe(false);
    expect(passwordSchema.safeParse("password").success).toBe(false);
    expect(passwordSchema.safeParse("PASSWORD123").success).toBe(false);
    expect(passwordSchema.safeParse("a".repeat(73)).success).toBe(false);
    expect(passwordSchema.safeParse("blue mango tree").success).toBe(true);
  });
});

describe("display names (shown to children) cannot carry contact details", () => {
  it("accepts first names and nicknames", () => {
    for (const ok of ["Tendai", "Rudo M", "Mr. Moyo", "Chipo-Ann", "T"]) {
      expect(displayNameSchema.safeParse(ok).success, ok).toBe(true);
    }
  });

  it("rejects emails, links and phone numbers", () => {
    for (const bad of ["tendai@gmail.com", "call me 0771234567", "+263 77 123 4567", "www.site.com", "http://x", "me.com"]) {
      expect(looksLikeContactDetails(bad), bad).toBe(true);
      expect(displayNameSchema.safeParse(bad).success, bad).toBe(false);
    }
  });

  it("rejects empty, over-long and control-character names", () => {
    expect(displayNameSchema.safeParse("   ").success).toBe(false);
    expect(displayNameSchema.safeParse("x".repeat(41)).success).toBe(false);
    expect(displayNameSchema.safeParse("bad\u0007name").success).toBe(false);
  });
});

describe("grades", () => {
  it("accepts 3 to 7 (including form-encoded strings) and nothing else", () => {
    for (const g of [3, 4, 5, 6, 7, "5"]) expect(gradeSchema.safeParse(g).success).toBe(true);
    for (const g of [2, 8, 3.5, "abc", "", null, -1]) expect(gradeSchema.safeParse(g).success, String(g)).toBe(false);
  });
});

describe("forms", () => {
  it("requires a guardian to affirm responsibility when signing up", () => {
    const base = { displayName: "Mai Tendai", email: "mai@example.com", password: "blue mango tree" };
    expect(parentSignUpSchema.safeParse({ ...base, isGuardian: "on" }).success).toBe(true);
    expect(parentSignUpSchema.safeParse(base).success).toBe(false);
    expect(parentSignUpSchema.safeParse({ ...base, isGuardian: "off" }).success).toBe(false);
  });

  it("validates a new learner, including that the password differs from the username", () => {
    const ok = { displayName: "Tendai", username: "Tendai7", password: "blue mango tree", grade: "4" };
    const parsed = createLearnerSchema.parse(ok);
    expect(parsed).toMatchObject({ username: "tendai7", grade: 4 });
    expect(createLearnerSchema.safeParse({ ...ok, password: "tendai7tendai7".slice(0, 7) }).success).toBe(false);
    expect(createLearnerSchema.safeParse({ ...ok, username: "abcdefgh", password: "ABCDEFGH" }).success).toBe(false);
    expect(createLearnerSchema.safeParse({ ...ok, grade: "9" }).success).toBe(false);
  });

  it("normalises learner sign-in usernames", () => {
    expect(learnerSignInSchema.parse({ username: " Tendai ", password: "x" }).username).toBe("tendai");
  });
});

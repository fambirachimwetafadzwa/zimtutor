import { describe, expect, it } from "vitest";
import { safeRedirectPath } from "@/lib/auth/redirects";
import { canAccessPath, homePathForRole, isAppRole, roleForPath } from "@/lib/auth/roles";

describe("safeRedirectPath (open-redirect protection)", () => {
  it("keeps ordinary same-site paths, queries and hashes", () => {
    expect(safeRedirectPath("/student")).toBe("/student");
    expect(safeRedirectPath("/student/learn/G3-NUM-PLACE-VALUE-001?x=1#top")).toBe(
      "/student/learn/G3-NUM-PLACE-VALUE-001?x=1#top",
    );
  });

  it("falls back for empty or missing input", () => {
    expect(safeRedirectPath(null)).toBe("/");
    expect(safeRedirectPath(undefined, "/parent")).toBe("/parent");
    expect(safeRedirectPath("")).toBe("/");
  });

  it("rejects absolute and protocol-relative URLs", () => {
    for (const evil of [
      "https://evil.example",
      "http://evil.example/x",
      "//evil.example",
      "///evil.example",
      "javascript:alert(1)",
      "data:text/html,x",
      "evil.example",
    ]) {
      expect(safeRedirectPath(evil), evil).toBe("/");
    }
  });

  it("rejects backslash, control-character and encoded tricks", () => {
    for (const evil of ["/\\evil.example", "/%5Cevil.example", "/%2F/evil.example", "/%2f%2fevil.example", "/a\nb", "/a\u0000b", "/%00", "/%E0%A4%A"]) {
      expect(safeRedirectPath(evil), JSON.stringify(evil)).toBe("/");
    }
  });

  it("rejects absurdly long values", () => {
    expect(safeRedirectPath("/" + "a".repeat(400))).toBe("/");
  });
});

describe("role routing", () => {
  it("sends each role to its own home", () => {
    expect(homePathForRole("student")).toBe("/student");
    expect(homePathForRole("parent")).toBe("/parent");
    expect(homePathForRole("admin")).toBe("/admin");
  });

  it("recognises roles strictly", () => {
    expect(isAppRole("admin")).toBe(true);
    expect(isAppRole("teacher")).toBe(false);
    expect(isAppRole(undefined)).toBe(false);
  });

  it("restricts sections by role and does not confuse look-alike prefixes", () => {
    expect(roleForPath("/student/learn/x")).toBe("student");
    expect(roleForPath("/administrator")).toBeNull(); // not /admin
    expect(roleForPath("/parenting-tips")).toBeNull(); // not /parent
    expect(roleForPath("/privacy")).toBeNull();
    expect(canAccessPath("student", "/admin")).toBe(false);
    expect(canAccessPath("parent", "/student")).toBe(false);
    expect(canAccessPath("admin", "/parent")).toBe(false);
    expect(canAccessPath("parent", "/parent/learners/new")).toBe(true);
    expect(canAccessPath("student", "/privacy")).toBe(true);
  });
});

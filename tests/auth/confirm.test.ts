import { describe, expect, it } from "vitest";
import { parseConfirmLink } from "../../src/lib/auth/confirm";

const link = (query: string) => parseConfirmLink(new URLSearchParams(query));
const TOKEN = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8";

describe("the link in an email from the sign-in service", () => {
  it("is read: its token, its kind, and where to go next", () => {
    expect(link(`token_hash=${TOKEN}&type=recovery&next=/reset-password`)).toEqual({
      tokenHash: TOKEN,
      type: "recovery",
      next: "/reset-password",
    });
    expect(link(`token_hash=${TOKEN}&type=signup&next=/parent`)).toMatchObject({
      type: "signup",
      next: "/parent",
    });
  });

  it("goes to the new-password page for a recovery link and home for the others, when next is missing", () => {
    expect(link(`token_hash=${TOKEN}&type=recovery`)?.next).toBe("/reset-password");
    expect(link(`token_hash=${TOKEN}&type=email`)?.next).toBe("/");
  });

  it("never sends anyone off the site", () => {
    for (const evil of [
      "https://evil.example",
      "//evil.example",
      "/\\evil.example",
      "javascript:alert(1)",
      "/%2F/evil.example",
    ])
      expect(
        link(`token_hash=${TOKEN}&type=recovery&next=${encodeURIComponent(evil)}`)?.next,
        evil,
      ).toBe("/reset-password");
  });

  it("is nothing when the token is missing, odd or too short", () => {
    for (const bad of [
      "",
      "short",
      "has space in it aaaaaaaaaaaaaaaa",
      "<script>aaaaaaaaaaaaaaaaaaa",
      "a".repeat(201),
      "../../../etc/passwd/aaa",
    ])
      expect(link(`token_hash=${encodeURIComponent(bad)}&type=recovery`), bad).toBeNull();
    expect(link("type=recovery")).toBeNull();
  });

  it("is nothing for a kind of link ZimTutor does not send", () => {
    for (const type of ["magiclink", "invite", "email_change", "admin", "", "RECOVERY"])
      expect(link(`token_hash=${TOKEN}&type=${type}`), type).toBeNull();
    expect(link(`token_hash=${TOKEN}`)).toBeNull();
  });
});

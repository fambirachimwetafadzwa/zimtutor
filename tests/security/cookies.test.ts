import { describe, expect, it } from "vitest";
import { sessionCookieOptions } from "../../src/lib/supabase/cookies";

describe("the session cookie", () => {
  it("is out of reach of any script on the page, and not sent along with other sites' requests", () => {
    const options = sessionCookieOptions("https://zimtutor.example");
    expect(options).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/" });
  });

  it("is secure on a site served over https, and only there", () => {
    expect(sessionCookieOptions("https://zimtutor.example").secure).toBe(true);
    expect(sessionCookieOptions("http://localhost:3000").secure).toBe(false);
  });
});

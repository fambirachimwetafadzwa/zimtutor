import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

/**
 * The sign-in service's side of "I forgot my password", with the real service: a one-time token that
 * can be exchanged for a session from any client, that sets a new password, that works once, and that
 * cannot be made for an address that has no account.
 */

const URL = process.env.INTEGRATION_SUPABASE_URL;
const ANON = process.env.INTEGRATION_SUPABASE_ANON_KEY;
const SERVICE = process.env.INTEGRATION_SUPABASE_SERVICE_ROLE_KEY;
const configured = Boolean(URL && ANON && SERVICE);
const options = { auth: { persistSession: false, autoRefreshToken: false } } as const;
const PASSWORD = "correct horse battery staple";
const run = Date.now().toString(36);

describe.skipIf(!configured)("recovering a password (real API)", () => {
  const anonymous = () => createClient(URL!, ANON!, options);
  const service = () => createClient(URL!, SERVICE!, options);

  async function parent(label: string) {
    const email = `${label}-${run}@example.test`;
    const { error } = await anonymous().auth.signUp({ email, password: PASSWORD });
    if (error) throw error;
    return email;
  }

  async function recoveryToken(email: string): Promise<string> {
    const { data, error } = await service().auth.admin.generateLink({ type: "recovery", email });
    if (error || !data.properties?.hashed_token) throw error ?? new Error("no link");
    return data.properties.hashed_token;
  }

  it("lets a one-time token from any client set a new password, once", async () => {
    const email = await parent("rec-one");
    const token = await recoveryToken(email);

    // a client that never asked for the email can still use the link
    const elsewhere = anonymous();
    const verified = await elsewhere.auth.verifyOtp({ type: "recovery", token_hash: token });
    expect(verified.error).toBeNull();
    expect(verified.data.session).toBeTruthy();

    const changed = await elsewhere.auth.updateUser({ password: "a different long password" });
    expect(changed.error).toBeNull();

    expect(
      (await anonymous().auth.signInWithPassword({ email, password: PASSWORD })).error,
    ).toBeTruthy();
    expect(
      (await anonymous().auth.signInWithPassword({ email, password: "a different long password" }))
        .error,
    ).toBeNull();

    // the token has been used
    const again = await anonymous().auth.verifyOtp({ type: "recovery", token_hash: token });
    expect(again.error).toBeTruthy();
    expect(again.data.session).toBeNull();
  });

  it("refuses a token that was made up", async () => {
    const made = await anonymous().auth.verifyOtp({
      type: "recovery",
      token_hash: "f".repeat(64),
    });
    expect(made.error).toBeTruthy();
    expect(made.data.session).toBeNull();
  });

  it("gives the same answer to a request for an address that has no account", async () => {
    const known = await parent("rec-two");
    const unknown = `nobody-${run}@example.test`;
    const a = await anonymous().auth.resetPasswordForEmail(known);
    const b = await anonymous().auth.resetPasswordForEmail(unknown);
    // whatever the service says about one it says about the other: nothing here can tell who has an account
    expect(Boolean(a.error)).toBe(Boolean(b.error));
    expect(a.error?.status ?? 200).toBe(b.error?.status ?? 200);
  });

  it("will not set a password that is too short, even with a good token", async () => {
    const email = await parent("rec-three");
    const client = anonymous();
    await client.auth.verifyOtp({ type: "recovery", token_hash: await recoveryToken(email) });
    const weak = await client.auth.updateUser({ password: "short" });
    expect(weak.error).toBeTruthy();
    expect(
      (await anonymous().auth.signInWithPassword({ email, password: PASSWORD })).error,
    ).toBeNull();
  });
});

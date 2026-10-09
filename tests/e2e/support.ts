import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { LIMITS, type Bucket } from "../../src/lib/ratelimit/policy";
import { rateLimitSecret } from "../../src/lib/ratelimit/secret";
import { subjectHash } from "../../src/lib/ratelimit/subject";

/** Shared helpers for the browser tests. Users are created through the real UI wherever possible. */

export const e2eConfigured = Boolean(
  process.env.E2E_BASE_URL &&
  process.env.INTEGRATION_SUPABASE_URL &&
  process.env.INTEGRATION_SUPABASE_ANON_KEY &&
  process.env.INTEGRATION_SUPABASE_SERVICE_ROLE_KEY,
);

export function skipUnlessConfigured() {
  test.skip(
    !e2eConfigured,
    "needs E2E_BASE_URL and INTEGRATION_SUPABASE_URL / _ANON_KEY / _SERVICE_ROLE_KEY",
  );
}

export const PASSWORD = "correct horse battery staple";
const clientOptions = { auth: { persistSession: false, autoRefreshToken: false } } as const;

export const serviceClient = (): SupabaseClient =>
  createClient(
    process.env.INTEGRATION_SUPABASE_URL!,
    process.env.INTEGRATION_SUPABASE_SERVICE_ROLE_KEY!,
    clientOptions,
  );

/** A short unique suffix so repeated runs never collide on emails or usernames. */
export const unique = () =>
  `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

export async function signUpParent(page: Page, name: string, email: string) {
  await page.goto("/signup");
  await page.getByLabel("Your first name or nickname").fill(name);
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Create parent account" }).click();
  await expect(page).not.toHaveURL(/\/signup/);
}

export async function addLearner(
  page: Page,
  input: { name: string; username: string; grade: number },
) {
  await page.goto("/parent/learners/new");
  await page.getByLabel("Learner's first name or nickname").fill(input.name);
  await page.getByLabel("Username").fill(input.username);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.locator(`input[name="grade"][value="${input.grade}"]`).check({ force: true });
  await page.getByRole("button", { name: "Create learner account" }).click();
  await expect(page).toHaveURL(/\/parent\?added=/);
}

export async function signOut(page: Page) {
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);
}

export async function signInLearner(page: Page, username: string) {
  await page.goto("/login?who=learner");
  await page.getByLabel("Your username").fill(username);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/student/);
}

export async function signInParent(page: Page, email: string) {
  await page.goto("/login?who=parent");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

/** Make an existing parent an administrator, the way an operator would (out of band, never via the UI). */
export async function promoteToAdmin(email: string) {
  const anon = createClient(
    process.env.INTEGRATION_SUPABASE_URL!,
    process.env.INTEGRATION_SUPABASE_ANON_KEY!,
    clientOptions,
  );
  const { data, error } = await anon.auth.signInWithPassword({ email, password: PASSWORD });
  if (error || !data.user) throw new Error(`cannot sign in ${email}: ${error?.message}`);
  const { error: updateError } = await serviceClient()
    .from("profiles")
    .update({ role: "admin" })
    .eq("id", data.user.id);
  if (updateError) throw updateError;
  return data.user.id;
}

/** Create a parent through the UI, then promote them. Leaves the page signed in as an administrator. */
export async function signUpAdmin(page: Page, label: string) {
  const email = `${label}-${unique()}@example.test`;
  await signUpParent(page, "Admin Ann", email);
  await promoteToAdmin(email);
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin/);
  return email;
}

/** The id of a learner account, by the username it was made with. */
export async function learnerIdOf(username: string): Promise<string> {
  const { data, error } = await serviceClient()
    .from("learner_profiles")
    .select("profile_id")
    .eq("username", username)
    .single();
  if (error || !data) throw new Error(`no learner ${username}: ${error?.message}`);
  return data.profile_id as string;
}

/** What the server stores for a thing it counts: the same keyed hash it makes (with the same secret). */
function limitHash(bucket: Bucket, subject: string): string {
  return subjectHash(
    rateLimitSecret({
      rateLimitSecret: process.env.RATE_LIMIT_SECRET || undefined,
      supabaseServiceRoleKey: process.env.INTEGRATION_SUPABASE_SERVICE_ROLE_KEY!,
    }),
    bucket,
    subject,
  );
}

/**
 * Use up a limit for someone, as a great many fast clicks would, without the clicks.
 */
export async function useUpLimit(bucket: Bucket, subject: string, hits = LIMITS[bucket].max) {
  const { max, seconds } = LIMITS[bucket];
  // not on the edge of a window: the count must still be there when the browser comes
  const left = seconds - ((Date.now() / 1000) % seconds);
  if (left < 10) await new Promise((resolve) => setTimeout(resolve, (left + 1) * 1000));
  const hash = limitHash(bucket, subject);
  const service = serviceClient();
  for (let done = 0; done < hits; done += 25) {
    const batch = await Promise.all(
      Array.from({ length: Math.min(25, hits - done) }, () =>
        service.rpc("rate_limit_hit", {
          p_bucket: bucket,
          p_subject: hash,
          p_limit: max,
          p_window_seconds: seconds,
        }),
      ),
    );
    for (const { error } of batch) if (error) throw error;
  }
}

/** How many hits are counted now for someone (in the current window), without adding one. */
export async function limitCount(bucket: Bucket, subject: string): Promise<number> {
  const { max, seconds } = LIMITS[bucket];
  const { data, error } = await serviceClient().rpc("rate_limit_peek", {
    p_bucket: bucket,
    p_subject: limitHash(bucket, subject),
    p_limit: max,
    p_window_seconds: seconds,
  });
  if (error) throw error;
  return (data as Array<{ hits: number }>)[0]!.hits;
}

/**
 * A screenshot for the test report; with E2E_SCREENSHOTS=<folder> it is also saved there, so that
 * how a screen looks can be seen without running the app.
 */
export async function snap(page: Page, testInfo: TestInfo, name: string, fullPage = false) {
  const body = await page.screenshot({ fullPage });
  await testInfo.attach(`${testInfo.project.name}-${name}`, { body, contentType: "image/png" });
  const folder = process.env.E2E_SCREENSHOTS;
  if (folder) {
    await mkdir(folder, { recursive: true });
    await writeFile(path.join(folder, `${testInfo.project.name}-${name}.png`), body);
  }
}

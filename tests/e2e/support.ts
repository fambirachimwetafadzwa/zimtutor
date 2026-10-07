import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

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

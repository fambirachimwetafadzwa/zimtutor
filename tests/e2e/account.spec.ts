import { expect, test, type Page } from "@playwright/test";
import {
  PASSWORD,
  addLearner,
  learnerIdOf,
  serviceClient,
  signInLearner,
  signUpParent,
  skipUnlessConfigured,
  snap,
  unique,
} from "./support";

skipUnlessConfigured();

/**
 * A parent looking after their children's accounts, in a browser: a new password for a child, deleting
 * a child's account and everything saved about it, and deleting their own account. Each of the last
 * two asks the parent to show they mean it, and neither can be done for anyone else's child.
 */

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
}

async function rowsAbout(learnerId: string) {
  const service = serviceClient();
  const counts: Record<string, number> = {};
  for (const [table, column] of [
    ["profiles", "id"],
    ["learner_profiles", "profile_id"],
    ["guardianships", "learner_id"],
    ["tutor_sessions", "learner_id"],
    ["question_attempts", "learner_id"],
  ] as const) {
    const { count, error } = await service
      .from(table)
      .select("*", { count: "exact", head: true })
      .eq(column, learnerId);
    if (error) throw error;
    counts[table] = count ?? 0;
  }
  return counts;
}

async function openChild(page: Page, name: string) {
  await page.goto("/parent");
  await page.getByRole("link", { name: "See progress" }).first().click();
  await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
}

test.describe("a parent looking after their children's accounts", () => {
  test("a new password for a child, then deleting the child's account and everything saved about it", async ({
    page,
    browser,
  }, testInfo) => {
    const id = unique();
    const username = `acc${id}`.slice(0, 24);
    await signUpParent(page, "Mrs Hove", `acct-${id}@example.test`);
    await addLearner(page, { name: "Chipo", username, grade: 5 });
    const learnerId = await learnerIdOf(username);

    // a record to be deleted: the child does a little work first
    const context = await browser.newContext(testInfo.project.use);
    const child = await context.newPage();
    await signInLearner(child, username);
    await child
      .getByRole("region", { name: /Start something new/i })
      .getByRole("link")
      .click();
    await child.getByRole("button", { name: "Start" }).click();
    await expect(child.getByText("Official curriculum").first()).toBeVisible();
    expect((await rowsAbout(learnerId)).tutor_sessions).toBe(1);

    // ── a new password ────────────────────────────────────────────────────────────────────────
    await openChild(page, "Chipo");
    await page.getByText("Change Chipo's password").click();
    const newPassword = "a brand new long password";
    await page.getByLabel("New password").fill("password"); // too easy
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page.getByText(/too easy to guess/)).toBeVisible();
    await page.getByLabel("New password").fill(newPassword);
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(
      page.getByText("The password has been changed. Tell your child the new one."),
    ).toBeVisible();

    const other = await browser.newContext(testInfo.project.use);
    const again = await other.newPage();
    await again.goto("/login?who=learner");
    await again.getByLabel("Your username").fill(username);
    await again.getByLabel("Password").fill(PASSWORD);
    await again.getByRole("button", { name: "Sign in" }).click();
    await expect(again.getByText(/couldn't sign you in/)).toBeVisible(); // the old password is no good
    await again.getByLabel("Password").fill(newPassword);
    await again.getByRole("button", { name: "Sign in" }).click();
    await expect(again).toHaveURL(/\/student/);
    await other.close();

    // ── deleting the account ──────────────────────────────────────────────────────────────────
    await page.getByText("Delete Chipo's account", { exact: true }).click();
    await expect(page.getByText(/cannot be undone/).first()).toBeVisible();
    await noHorizontalScroll(page);
    await snap(page, testInfo, "account-1-child");

    // not by accident: the username has to be typed, and typed right
    await page.getByLabel(`Type ${username} to show that you mean it`).fill("chipo");
    await page.getByRole("button", { name: /Delete Chipo's account and everything saved/ }).click();
    await expect(page.getByText("Please type the username exactly as it is shown.")).toBeVisible();
    expect((await rowsAbout(learnerId)).profiles).toBe(1);

    await page.getByLabel(`Type ${username} to show that you mean it`).fill(username);
    await page.getByRole("button", { name: /Delete Chipo's account and everything saved/ }).click();
    await expect(page).toHaveURL(/\/parent\?removed=1/);
    await expect(
      page.getByText("The learner account and everything saved about it have been deleted."),
    ).toBeVisible();
    await expect(page.getByText("You haven't added a learner yet.")).toBeVisible();
    await snap(page, testInfo, "account-2-after-child");

    // everything is gone, and the child can no longer sign in
    expect(await rowsAbout(learnerId)).toEqual({
      profiles: 0,
      learner_profiles: 0,
      guardianships: 0,
      tutor_sessions: 0,
      question_attempts: 0,
    });
    await child.goto("/student");
    await expect(child).toHaveURL(/\/login/);
    const gone = await browser.newContext(testInfo.project.use);
    const retry = await gone.newPage();
    await retry.goto("/login?who=learner");
    await retry.getByLabel("Your username").fill(username);
    await retry.getByLabel("Password").fill(newPassword);
    await retry.getByRole("button", { name: "Sign in" }).click();
    await expect(retry.getByText(/couldn't sign you in/)).toBeVisible();
    await gone.close();
    await context.close();
  });

  test("deleting a parent's own account asks for their password, and takes their children with it", async ({
    page,
    browser,
  }, testInfo) => {
    const id = unique();
    const email = `acct-own-${id}@example.test`;
    const username = `own${id}`.slice(0, 24);
    await signUpParent(page, "Mr Zhou", email);
    await addLearner(page, { name: "Tino", username, grade: 4 });
    const learnerId = await learnerIdOf(username);

    await page.getByRole("link", { name: "My account" }).click();
    await expect(page).toHaveURL(/\/parent\/account$/);
    await expect(page.getByRole("heading", { name: "My account", level: 1 })).toBeVisible();
    // it says whose accounts will go
    await expect(page.getByText("Tino").first()).toBeVisible();
    await expect(page.getByText(username)).toBeVisible();
    await noHorizontalScroll(page);
    await snap(page, testInfo, "account-3-own");

    // the word, and the password: each is needed
    await page.getByLabel("Your password").fill(PASSWORD);
    await page.getByRole("button", { name: /Delete my account/ }).click();
    await expect(
      page.getByText("Please type the word delete to show that you mean it."),
    ).toBeVisible();

    await page.getByLabel("Type the word delete to show that you mean it").fill("delete");
    await page.getByLabel("Your password").fill("not my password at all");
    await page.getByRole("button", { name: /Delete my account/ }).click();
    await expect(page.getByText("That is not your password.")).toBeVisible();
    expect((await rowsAbout(learnerId)).profiles).toBe(1);

    await page.getByLabel("Your password").fill(PASSWORD);
    await page.getByLabel("Type the word delete to show that you mean it").fill("delete");
    await page.getByRole("button", { name: /Delete my account/ }).click();
    await expect(page).toHaveURL(/\/login\?who=parent&deleted=1/);
    await expect(
      page.getByText("Your account and everything saved about it have been deleted."),
    ).toBeVisible();

    // the parent and the child are both gone
    expect((await rowsAbout(learnerId)).profiles).toBe(0);
    const fresh = await browser.newContext(testInfo.project.use);
    const again = await fresh.newPage();
    await again.goto("/login?who=parent");
    await again.getByLabel("Email address").fill(email);
    await again.getByLabel("Password").fill(PASSWORD);
    await again.getByRole("button", { name: "Sign in" }).click();
    await expect(again.getByText(/couldn't sign you in/)).toBeVisible();
    await fresh.close();
    // a signed-out visitor is sent to sign in, not shown the page
    await page.goto("/parent/account");
    await expect(page).toHaveURL(/\/login/);
  });

  test("another family's child cannot be reached: the page is simply not there", async ({
    page,
    browser,
  }, testInfo) => {
    const id = unique();
    const username = `oth${id}`.slice(0, 24);
    await signUpParent(page, "Mrs Mlambo", `acct-a-${id}@example.test`);
    await addLearner(page, { name: "Anesu", username, grade: 6 });
    const learnerId = await learnerIdOf(username);

    const context = await browser.newContext(testInfo.project.use);
    const stranger = await context.newPage();
    await signUpParent(stranger, "Mr Sibanda", `acct-b-${id}@example.test`);
    const response = await stranger.goto(`/parent/learners/${learnerId}`);
    expect(response?.status()).toBe(404);
    await expect(stranger.getByText(/Delete .+ account/)).toHaveCount(0);
    await context.close();
    expect((await rowsAbout(learnerId)).profiles).toBe(1);
    // and the child's own parent still finds them
    await openChild(page, "Anesu");
  });
});

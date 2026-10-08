import { expect, test } from "@playwright/test";
import {
  addLearner,
  signInLearner,
  signOut,
  signUpAdmin,
  signUpParent,
  skipUnlessConfigured,
  unique,
} from "./support";

skipUnlessConfigured();

test.describe("accounts and roles, end to end", () => {
  test("a parent signs up, adds a learner, and the learner signs in to their own area", async ({
    page,
    browser,
  }) => {
    const id = unique();
    const email = `family-${id}@example.test`;
    const username = `kuda${id}`.slice(0, 24);

    await signUpParent(page, "Mrs Moyo", email);
    await page.goto("/parent");
    await expect(page.getByRole("heading", { name: "My learners" })).toBeVisible();

    await addLearner(page, { name: "Kuda", username, grade: 5 });
    const card = page.getByRole("listitem").filter({ hasText: username });
    await expect(card).toContainText("Kuda");
    await expect(card).toContainText("Grade 5");

    // The learner uses a separate browser: their own session, their own area.
    const learnerContext = await browser.newContext();
    const learner = await learnerContext.newPage();
    await signInLearner(learner, username);
    await expect(learner.getByRole("heading", { name: /Hello, Kuda/ })).toBeVisible();
    await expect(learner.getByText(/You're in Grade 5/)).toBeVisible();
    await learnerContext.close();
  });

  test("each role is kept in its own area", async ({ page, browser }) => {
    const id = unique();
    const username = `ada${id}`.slice(0, 24);
    await signUpParent(page, "Parent", `roles-${id}@example.test`);
    await addLearner(page, { name: "Ada", username, grade: 4 });

    // A parent cannot see the administration area.
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/parent/);

    // A learner cannot see the parent or administration areas.
    const learnerContext = await browser.newContext();
    const learner = await learnerContext.newPage();
    await signInLearner(learner, username);
    for (const path of ["/parent", "/parent/learners/new", "/admin"]) {
      await learner.goto(path);
      await expect(learner).toHaveURL(/\/student/);
    }
    await learnerContext.close();
  });

  test("signed-out visitors are sent to sign in, and then back to where they were going", async ({
    page,
  }) => {
    await page.goto("/parent");
    await expect(page).toHaveURL(/\/login\?.*next=%2Fparent/);
  });

  test("a wrong password gives one generic message", async ({ page }) => {
    await page.goto("/login?who=learner");
    await page.getByLabel("Your username").fill("nobody-here");
    await page.getByLabel("Password").fill("not the password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(
      page.getByText("We couldn't sign you in. Please check your details and try again."),
    ).toBeVisible();
  });

  test("a form that is refused keeps what was typed — except the password", async ({ page }) => {
    const email = `typo-${unique()}@example.test`;
    await page.goto("/signup");
    await page.getByLabel("Your first name or nickname").fill("Tendai");
    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Password").fill("short");
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Create parent account" }).click();

    await expect(page.getByRole("alert").filter({ hasText: /\w/ }).first()).toBeVisible();
    await expect(page.getByLabel("Your first name or nickname")).toHaveValue("Tendai");
    await expect(page.getByLabel("Email address")).toHaveValue(email);
    await expect(page.getByRole("checkbox")).toBeChecked();
    await expect(page.getByLabel("Password")).toHaveValue("");

    // A wrong learner password keeps the username but never the password.
    await page.goto("/login?who=learner");
    await page.getByLabel("Your username").fill("kept-name");
    await page.getByLabel("Password").fill("not the password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("We couldn't sign you in.")).toBeVisible();
    await expect(page.getByLabel("Your username")).toHaveValue("kept-name");
    await expect(page.getByLabel("Password")).toHaveValue("");
  });

  test("an administrator reaches the administration area and can sign out", async ({ page }) => {
    await signUpAdmin(page, "admin");
    await expect(page.getByRole("heading", { name: "Administration" })).toBeVisible();
    await page.goto("/parent");
    await expect(page).toHaveURL(/\/admin/); // an administrator is not a parent
    await signOut(page);
  });
});

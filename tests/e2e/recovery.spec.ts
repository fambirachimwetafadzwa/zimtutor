import { expect, test, type Page } from "@playwright/test";
import {
  PASSWORD,
  serviceClient,
  signOut,
  signUpParent,
  skipUnlessConfigured,
  snap,
  unique,
  useUpLimit,
} from "./support";

skipUnlessConfigured();

/**
 * A parent who has forgotten their password, in a browser: asking for a link (the answer never says
 * whether the address has an account), following the one-time link from any device, choosing a new
 * password, and being sure that the old one, the used link and the other places they were signed in
 * are all finished with. The email itself is not sent in these tests; its link is made the way the
 * sign-in service makes it, which is the part that matters.
 */

const SENT = /If that address has a ZimTutor account, we have sent it an email/;
const NEW_PASSWORD = "a brand new long password";

async function recoveryLink(email: string): Promise<string> {
  const { data, error } = await serviceClient().auth.admin.generateLink({
    type: "recovery",
    email,
  });
  if (error || !data.properties?.hashed_token) throw error ?? new Error("no link was made");
  return `/auth/confirm?token_hash=${data.properties.hashed_token}&type=recovery&next=/reset-password`;
}

async function askForLink(page: Page, email: string) {
  await page.goto("/forgot-password");
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Send me a link" }).click();
}

test.describe("a parent who has forgotten their password", () => {
  test("asks for a link, follows it, chooses a new password, and is finished with the old one and the link", async ({
    page,
  }, testInfo) => {
    const email = `recover-${unique()}@example.test`;
    await signUpParent(page, "Mrs Ncube", email);
    await signOut(page);

    // the way there, from the sign-in screen
    await page.goto("/login?who=parent");
    await page.getByRole("link", { name: "Forgot your password?" }).click();
    await expect(page).toHaveURL(/\/forgot-password$/);
    await snap(page, testInfo, "recovery-1-ask");

    // the same words for an address with an account, one without, and one that is not an address
    await askForLink(page, email);
    const known = await page.getByRole("status").innerText();
    expect(known).toMatch(SENT);
    for (const other of [
      `nobody-${unique()}@example.test`,
      "not an address",
      "chipo@learners.zimtutor.invalid",
    ]) {
      await askForLink(page, other);
      expect(await page.getByRole("status").innerText(), other).toBe(known);
    }

    // the link in the email, opened somewhere else entirely (a different browser context)
    const link = await recoveryLink(email);
    await page.context().clearCookies();
    await page.goto(link);
    await expect(page).toHaveURL(/\/reset-password$/);
    await expect(page.getByRole("heading", { name: "Choose a new password" })).toBeVisible();
    await expect(page.getByText("Hello, Mrs Ncube.")).toBeVisible();

    // each way of getting it wrong says so
    await page.getByLabel("New password", { exact: true }).fill(NEW_PASSWORD);
    await page.getByLabel("The same password again").fill("something else entirely");
    await page.getByRole("button", { name: "Save my new password" }).click();
    await expect(page.getByText("The two passwords are not the same.")).toBeVisible();
    await page.getByLabel("New password", { exact: true }).fill("short");
    await page.getByLabel("The same password again").fill("short");
    await page.getByRole("button", { name: "Save my new password" }).click();
    await expect(page.getByText(/Use at least 8 characters/)).toBeVisible();
    await page.getByLabel("New password", { exact: true }).fill(PASSWORD);
    await page.getByLabel("The same password again").fill(PASSWORD);
    await page.getByRole("button", { name: "Save my new password" }).click();
    await expect(page.getByText(/password you have not used before/)).toBeVisible();

    await page.getByLabel("New password", { exact: true }).fill(NEW_PASSWORD);
    await page.getByLabel("The same password again").fill(NEW_PASSWORD);
    await page.getByRole("button", { name: "Save my new password" }).click();
    await expect(page).toHaveURL(/\/parent\?passwordChanged=1/);
    await expect(page.getByText(/Your password has been changed/)).toBeVisible();
    await snap(page, testInfo, "recovery-2-done");

    // the new password works and the old one does not
    await signOut(page);
    await page.goto("/login?who=parent");
    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText(/couldn't sign you in/)).toBeVisible();
    await page.getByLabel("Password").fill(NEW_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/parent/);

    // the link works once
    await signOut(page);
    await page.goto(link);
    await expect(page).toHaveURL(/\/login\?who=parent&error=link/);
    await expect(page.getByText(/That link has run out or has been used already/)).toBeVisible();
  });

  test("choosing a new password signs out every other place the parent was signed in", async ({
    page,
    browser,
  }, testInfo) => {
    const email = `recover-other-${unique()}@example.test`;
    await signUpParent(page, "Mr Dube", email);

    // a second device, signed in with the old password
    const other = await browser.newContext(testInfo.project.use);
    const device = await other.newPage();
    await device.goto("/login?who=parent");
    await device.getByLabel("Email address").fill(email);
    await device.getByLabel("Password").fill(PASSWORD);
    await device.getByRole("button", { name: "Sign in" }).click();
    await expect(device).toHaveURL(/\/parent/);

    // the first device follows the link and chooses a new password
    await page.goto(await recoveryLink(email));
    await page.getByLabel("New password", { exact: true }).fill(NEW_PASSWORD);
    await page.getByLabel("The same password again").fill(NEW_PASSWORD);
    await page.getByRole("button", { name: "Save my new password" }).click();
    await expect(page).toHaveURL(/\/parent\?passwordChanged=1/);

    // the second is no longer signed in
    await device.goto("/parent");
    await expect(device).toHaveURL(/\/login/);
    await other.close();
  });

  test("a link is only a link: wrong, odd or pointing off the site, it leads nowhere it should not", async ({
    page,
  }) => {
    // not a token, not a kind of link ZimTutor sends
    for (const query of [
      "",
      "token_hash=short&type=recovery",
      `token_hash=${"a".repeat(40)}&type=magiclink`,
      `token_hash=${"f".repeat(64)}&type=recovery`,
    ]) {
      await page.goto(`/auth/confirm?${query}`);
      await expect(page, query).toHaveURL(/\/login\?who=parent&error=link/);
      await expect(page.getByText(/That link has run out or has been used already/)).toBeVisible();
    }

    // a good token with somewhere else to go still ends up on this site
    const email = `recover-next-${unique()}@example.test`;
    await signUpParent(page, "Mrs Moyo", email);
    await signOut(page);
    const { data } = await serviceClient().auth.admin.generateLink({ type: "recovery", email });
    await page.goto(
      `/auth/confirm?token_hash=${data.properties!.hashed_token}&type=recovery&next=${encodeURIComponent("https://evil.example/steal")}`,
    );
    await expect(page).toHaveURL(/localhost:\d+\/reset-password$|\/reset-password$/);
    expect(new URL(page.url()).hostname).not.toContain("evil");
  });

  test("the reset page is for someone who followed a link: anyone else is sent to ask for one", async ({
    page,
  }) => {
    await page.goto("/reset-password");
    await expect(page).toHaveURL(/\/forgot-password$/);
  });

  test("asking too often is answered kindly, and the limit is on the address asked for", async ({
    page,
  }) => {
    const email = `recover-limit-${unique()}@example.test`;
    await useUpLimit("reset.email", email, 3);
    await askForLink(page, email);
    await expect(
      page.getByText(/A lot of requests have been made\. Please try again in .+\./),
    ).toBeVisible();
    // another address is not held back
    await askForLink(page, `recover-free-${unique()}@example.test`);
    await expect(page.getByText(SENT)).toBeVisible();
  });
});

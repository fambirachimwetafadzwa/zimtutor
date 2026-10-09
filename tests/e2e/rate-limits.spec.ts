import { expect, test, type Page } from "@playwright/test";
import { LIMITS } from "../../src/lib/ratelimit/policy";
import { buttons, readyForQuestion } from "./lesson-support";
import {
  PASSWORD,
  addLearner,
  learnerIdOf,
  limitCount,
  serviceClient,
  signInLearner,
  signOut,
  snap,
  signUpParent,
  skipUnlessConfigured,
  unique,
  useUpLimit,
} from "./support";

skipUnlessConfigured();

/**
 * Limits on trying, in a browser: what a child, or someone guessing, actually sees. The counts are
 * proved exactly in the database tests; here the question is whether the screens say the right thing
 * and whether the limits protect the right people (one account, one place) and no one else.
 */

/**
 * The header the application believes an address from. The app must be started with
 * CLIENT_IP_HEADER set to this name (a header only these tests send: Next.js fills in
 * x-forwarded-for itself, so every local request would look like one place).
 */
const ADDRESS_HEADER = process.env.E2E_CLIENT_IP_HEADER?.toLowerCase();
const NEEDS_HEADER =
  "start the app with CLIENT_IP_HEADER=<a header name only the tests send> and set E2E_CLIENT_IP_HEADER to the same name";

const TOO_MANY = /Too many tries\. Please wait .+ and try again, or ask a grown-up to help\./;
const TOO_FAST = /You are going a little fast\. Please wait .+ and try again\./;
const TOO_MANY_PAPERS = /You have started a lot of papers just now\. Please try again in .+\./;

/** Fill the learner sign-in form and wait until the server has answered. */
async function trySigningIn(page: Page, username: string, password: string) {
  await page.getByLabel("Your username").fill(username);
  await page.getByLabel("Password").fill(password);
  await Promise.all([
    page.waitForResponse((response) => response.request().method() === "POST"),
    page.getByRole("button", { name: "Sign in" }).click(),
  ]);
}

async function twoLearners(page: Page, id: string) {
  await signUpParent(page, "Mrs Zulu", `limits-${id}@example.test`);
  const first = `lka${id}`.slice(0, 24);
  const second = `lkb${id}`.slice(0, 24);
  await addLearner(page, { name: "Ayanda", username: first, grade: 4 });
  await addLearner(page, { name: "Buhle", username: second, grade: 4 });
  return { first, second };
}

test.describe("limits on trying", () => {
  test("wrong passwords at one account lock that account for a while, kindly, and no other", async ({
    page,
    browser,
  }, testInfo) => {
    const { first, second } = await twoLearners(page, unique());
    const context = await browser.newContext(testInfo.project.use);
    const child = await context.newPage();
    await child.goto("/login?who=learner");

    for (let i = 0; i < LIMITS["login.account"].max; i++) {
      await trySigningIn(child, first, `wrong password number ${i}`);
      await expect(child.getByText(/couldn't sign you in/)).toBeVisible();
    }

    // the next try is refused with a kind message, even with the RIGHT password, and nothing is said
    // about whether the account exists or what was counted
    await trySigningIn(child, first, PASSWORD);
    await expect(child.getByText(TOO_MANY)).toBeVisible();
    await expect(child).toHaveURL(/\/login/);
    await expect(child.getByLabel("Password")).toHaveValue("");
    await snap(child, testInfo, "limits-1-sign-in");

    // a name that does not exist gets the same treatment once it has been tried as often
    const nobody = `nobody${unique()}`.slice(0, 24);
    for (let i = 0; i < LIMITS["login.account"].max; i++)
      await trySigningIn(child, nobody, "x".repeat(12));
    await trySigningIn(child, nobody, "x".repeat(12));
    await expect(child.getByText(TOO_MANY)).toBeVisible();

    // another child on the same screen is not affected
    await trySigningIn(child, second, PASSWORD);
    await expect(child).toHaveURL(/\/student/);
    await context.close();
  });

  test("a good sign-in ends the count of wrong tries", async ({ page, browser }, testInfo) => {
    const { first } = await twoLearners(page, unique());
    const context = await browser.newContext(testInfo.project.use);
    const child = await context.newPage();
    const wrong = LIMITS["login.account"].max - 1;
    for (let round = 0; round < 2; round++) {
      // seven wrong tries and a right one is eight; two rounds is sixteen, and still allowed
      await child.goto("/login?who=learner");
      for (let i = 0; i < wrong; i++)
        await trySigningIn(child, first, `wrong ${round} ${i} password`);
      await expect(child.getByText(/couldn't sign you in/)).toBeVisible();
      await trySigningIn(child, first, PASSWORD);
      await expect(child).toHaveURL(/\/student/);
      if (round === 0) await signOut(child);
    }
    await context.close();
  });

  test("a place that has failed a great many times is turned away, but only that place", async ({
    page,
    browser,
  }, testInfo) => {
    test.skip(!ADDRESS_HEADER, NEEDS_HEADER);
    const { first } = await twoLearners(page, unique());
    // an address from the range reserved for documentation, so it can never be anybody's
    const address = `203.0.113.${100 + Math.floor(Math.random() * 100)}`;
    await useUpLimit("login.address", address);

    const there = await browser.newContext({
      ...testInfo.project.use,
      extraHTTPHeaders: { [ADDRESS_HEADER!]: address },
    });
    const turnedAway = await there.newPage();
    await turnedAway.goto("/login?who=learner");
    await trySigningIn(turnedAway, first, PASSWORD);
    await expect(turnedAway.getByText(TOO_MANY)).toBeVisible();
    await expect(turnedAway).toHaveURL(/\/login/);
    await there.close();

    const elsewhere = await browser.newContext({
      ...testInfo.project.use,
      extraHTTPHeaders: { [ADDRESS_HEADER!]: "203.0.113.50" },
    });
    const welcome = await elsewhere.newPage();
    await welcome.goto("/login?who=learner");
    await trySigningIn(welcome, first, PASSWORD);
    await expect(welcome).toHaveURL(/\/student/);
    await elsewhere.close();
  });

  test("good sign-ins from one place do not count against it (a classroom is not an attack), failures do", async ({
    page,
    browser,
  }, testInfo) => {
    test.skip(!ADDRESS_HEADER, NEEDS_HEADER);
    const { first, second } = await twoLearners(page, unique());
    const address = `203.0.113.${100 + Math.floor(Math.random() * 100)}`;
    const context = await browser.newContext({
      ...testInfo.project.use,
      extraHTTPHeaders: { [ADDRESS_HEADER!]: address },
    });
    const child = await context.newPage();
    for (const username of [first, second, first, second]) {
      await signInLearner(child, username);
      await signOut(child);
    }
    // eight good sign-ins and a place with nothing counted against it (it was never even seen failing)
    expect(await limitCount("login.address", address)).toBe(0);
    // whereas a failure is counted
    const stranger = await context.newPage();
    await stranger.goto("/login?who=learner");
    await trySigningIn(stranger, first, "not the password at all");
    expect(await limitCount("login.address", address)).toBe(1);
    await context.close();
  });

  test("a visitor cannot choose which address they are counted under", async ({
    page,
    browser,
  }, testInfo) => {
    // only a header the operator named is believed; any other is just something a visitor sent
    test.skip(ADDRESS_HEADER === "x-forwarded-for", "x-forwarded-for is the trusted header here");
    const { first } = await twoLearners(page, unique());
    const address = `203.0.113.${100 + Math.floor(Math.random() * 100)}`;
    await useUpLimit("login.address", address);
    const context = await browser.newContext({
      ...testInfo.project.use,
      extraHTTPHeaders: {
        "x-forwarded-for": address,
        "x-real-ip": address,
        "cf-connecting-ip": address,
      },
    });
    const child = await context.newPage();
    await child.goto("/login?who=learner");
    await trySigningIn(child, first, PASSWORD);
    await expect(child).toHaveURL(/\/student/);
    await context.close();
  });

  test("a child who goes too fast is asked to slow down, and what they sent is not kept", async ({
    page,
    browser,
  }, testInfo) => {
    const id = unique();
    const username = `fst${id}`.slice(0, 24);
    await signUpParent(page, "Mr Phiri", `fast-${id}@example.test`);
    await addLearner(page, { name: "Tendai", username, grade: 7 });
    const learnerId = await learnerIdOf(username);
    const context = await browser.newContext(testInfo.project.use);
    const learner = await context.newPage();
    await signInLearner(learner, username);

    // ── a lesson: a question of their own, after too many ────────────────────────────────────
    await learner
      .getByRole("region", { name: /Start something new/i })
      .getByRole("link")
      .click();
    await learner.getByRole("button", { name: buttons.start }).click();
    await readyForQuestion(learner);
    await useUpLimit("tutor.ask", learnerId);
    await learner.getByText("Ask ZimTutor a question").click();
    await learner.getByRole("textbox", { name: /Type your question/ }).fill("why do we carry?");
    await learner.getByRole("button", { name: "Send", exact: true }).click();
    // the message is where the child is looking, and what they typed is still there to send again
    await expect(learner.getByText(TOO_FAST)).toBeInViewport();
    await expect(learner.getByRole("textbox", { name: /Type your question/ })).toHaveValue(
      "why do we carry?",
    );
    await snap(learner, testInfo, "limits-2-lesson-question");
    const { count: kept } = await serviceClient()
      .from("tutor_messages")
      .select("id", { count: "exact", head: true })
      .eq("learner_id", learnerId)
      .eq("kind", "LEARNER_MESSAGE");
    expect(kept).toBe(0);

    // ── the buttons of a lesson, after too many ──────────────────────────────────────────────
    await useUpLimit("tutor.step", learnerId);
    await learner.getByRole("button", { name: buttons.hint }).click();
    await expect(learner.getByText(TOO_FAST).first()).toBeInViewport();
    await expect(learner.getByText(/^Hint 1 of \d/)).toHaveCount(0);

    // ── a practice paper, after too many starts ──────────────────────────────────────────────
    await useUpLimit("exam.start", learnerId);
    await learner.goto("/student/exams");
    await learner
      .getByRole("button", { name: /Short paper: 20 multiple-choice questions/ })
      .click();
    await expect(learner.getByText(TOO_MANY_PAPERS)).toBeInViewport();
    await snap(learner, testInfo, "limits-3-paper");
    await expect(learner).toHaveURL(/\/student\/exams$/);
    const { count: papers } = await serviceClient()
      .from("assessment_sets")
      .select("id", { count: "exact", head: true })
      .eq("learner_id", learnerId);
    expect(papers).toBe(0);
    await context.close();
  });
});

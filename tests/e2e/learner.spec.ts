import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import type { LearnerAnswer } from "../../src/lib/marking/spec";
import type { PublicQuestion, QuestionKey } from "../../src/lib/questions/bank-rows";
import { buttons, fillAnswer, openQuestion } from "./lesson-support";
import {
  addLearner,
  serviceClient,
  signInLearner,
  signUpParent,
  skipUnlessConfigured,
  unique,
} from "./support";

skipUnlessConfigured();

/**
 * A child at work, from sign-in to a finished lesson, on a desktop and on a phone. The spec only
 * does what a child can do in the browser; the one thing it reads from outside is the right answer
 * (with the service key, which a child's browser never has) so that it can answer correctly -- and
 * deliberately wrongly first.
 */

const GOAL = "G5-OPS-ADDITION-WHOLE-NUMBERS-001";
const NUMBER = "0771234567";

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
}

/**
 * Screenshots go into the test report; with E2E_SCREENSHOTS=<folder> they are also saved there, so
 * that how the screens look can be seen without running the app.
 */
async function snap(page: Page, testInfo: TestInfo, name: string) {
  const body = await page.screenshot({ fullPage: true });
  await testInfo.attach(`${testInfo.project.name}-${name}`, { body, contentType: "image/png" });
  const folder = process.env.E2E_SCREENSHOTS;
  if (folder) {
    await mkdir(folder, { recursive: true });
    await writeFile(path.join(folder, `${testInfo.project.name}-${name}.png`), body);
  }
}

/** An answer that is certainly wrong, in the shape the question's form takes. */
function wrongAnswer(key: QuestionKey, question: PublicQuestion): LearnerAnswer {
  const right = key.display;
  switch (question.answerKind) {
    case "CHOICE":
      return question.options!.find((o) => o.id !== right)!.id;
    case "TRUE_FALSE":
      return !right;
    case "ORDER":
      return [...(right as string[])].reverse();
    case "MATCH": {
      const pairs = right as Record<string, string>;
      const lefts = Object.keys(pairs);
      const rights = lefts.map((l) => pairs[l]!);
      const shifted = [...rights.slice(1), rights[0]!];
      return Object.fromEntries(lefts.map((l, i) => [l, shifted[i]!]));
    }
    case "BOXES":
      return Object.fromEntries(Object.keys(right as object).map((k) => [k, "-7"]));
    default:
      return "-7";
  }
}

/** Press "Check my answer" unless the form has already sent the answer (true/false buttons). */
async function submit(page: Page, kind: Awaited<ReturnType<typeof fillAnswer>>) {
  if (kind !== "true-false") await page.getByRole("button", { name: buttons.check }).click();
}

async function learnerIdOf(username: string): Promise<string> {
  const { data, error } = await serviceClient()
    .from("learner_profiles")
    .select("profile_id")
    .eq("username", username)
    .single();
  if (error || !data) throw new Error(`no learner ${username}: ${error?.message}`);
  return data.profile_id as string;
}

async function sessionCount(learnerId: string): Promise<number> {
  const { count, error } = await serviceClient()
    .from("tutor_sessions")
    .select("id", { count: "exact", head: true })
    .eq("learner_id", learnerId);
  if (error) throw error;
  return count ?? 0;
}

/** Click "Next" until a question is waiting for an answer. */
async function readyForQuestion(page: Page) {
  const tries = page.getByText(/^Tries left: \d/);
  // only an enabled button counts: while a step is being worked out, "Next" is switched off
  const next = page.getByRole("button", { name: buttons.next, exact: true, disabled: false });
  for (let i = 0; i < 8; i++) {
    await expect(next.or(tries)).toBeVisible();
    if (await tries.isVisible()) return;
    await next.click({ timeout: 5_000 });
  }
  await expect(tries).toBeVisible();
}

test.describe("a learner at work", () => {
  test("home, a lesson with a wrong try and a hint, a question of their own, and the record of it", async ({
    page,
    browser,
  }, testInfo) => {
    const id = unique();
    const username = `lea${id}`.slice(0, 24);
    await signUpParent(page, "Mrs Chuma", `learner-${id}@example.test`);
    await addLearner(page, { name: "Chipo", username, grade: 5 });
    const learnerId = await learnerIdOf(username);

    const context = await browser.newContext(testInfo.project.use);
    const learner = await context.newPage();
    await signInLearner(learner, username);

    // ── home: something new to start, nothing done yet ───────────────────────────────────────
    await expect(learner.getByRole("heading", { name: "Hello, Chipo!" })).toBeVisible();
    const main = learner.getByRole("region", { name: /Start something new/i });
    await expect(main).toBeVisible();
    await expect(
      learner.getByText(/\d+ goals in your grade that ZimTutor can practise/),
    ).toBeVisible();
    await expect(
      learner.getByText("When you finish a lesson, it will show up here."),
    ).toBeVisible();
    await noHorizontalScroll(learner);
    await snap(learner, testInfo, "1-home-new");

    // ── opening the lesson changes nothing; Start begins it ─────────────────────────────────
    await main.getByRole("link").click();
    await expect(learner).toHaveURL(/\/student\/learn\//);
    await expect(learner.getByText("Learning goal")).toBeVisible();
    const goalText = (await learner.getByRole("heading", { level: 1 }).innerText()).trim();
    expect(await sessionCount(learnerId)).toBe(0);
    await learner.getByRole("button", { name: buttons.start }).click();
    await expect(learner.getByText("Official curriculum").first()).toBeVisible();
    await expect(
      learner.getByText(/Revised Junior Mathematics Syllabus.*, page \d+/).first(),
    ).toBeVisible();
    expect(await sessionCount(learnerId)).toBe(1);

    // ── explanation, example, first question ────────────────────────────────────────────────
    await readyForQuestion(learner);
    await expect(learner.getByText(/not part of the syllabus/).first()).toBeVisible();
    await noHorizontalScroll(learner);
    await snap(learner, testInfo, "2-first-question");

    // ── a wrong try: it costs a try, nothing is given away, a hint is available ──────────────
    const { key, question } = await openQuestion(serviceClient(), learnerId);
    const kind = await fillAnswer(learner, key, question, wrongAnswer(key, question));
    await submit(learner, kind);
    await expect(learner.getByText("Tries left: 2")).toBeVisible();
    await expect(learner.getByText(/^My answer:/).first()).toBeVisible();

    await learner.getByRole("button", { name: buttons.hint }).click();
    await expect(learner.getByText(/^Hint 1 of \d/)).toBeVisible();
    await snap(learner, testInfo, "3-wrong-then-hint");

    // ── the right answer ends the question ──────────────────────────────────────────────────
    const again = await fillAnswer(learner, key, question);
    await submit(learner, again);
    const nextQuestion = learner.getByRole("button", { name: buttons.nextQuestion });
    await expect(nextQuestion).toBeVisible();

    // ── a question of their own, with a phone number in it: the number is never kept ─────────
    await learner.getByText("Ask ZimTutor a question").click();
    await learner
      .getByRole("textbox", { name: /Type your question/ })
      .fill(`why do we carry the one? my number is ${NUMBER}`);
    await learner.getByRole("button", { name: "Send", exact: true }).click();
    const conversation = learner.getByRole("list", { name: "Your lesson so far" });
    await expect(conversation.getByText("[removed]")).toBeVisible();
    await expect(conversation.getByText(/keep private things like phone numbers/)).toBeVisible();
    await expect(learner.locator("body")).not.toContainText(NUMBER);
    const { data: stored } = await serviceClient()
      .from("tutor_messages")
      .select("content, flagged")
      .eq("learner_id", learnerId);
    expect(JSON.stringify(stored)).not.toContain(NUMBER);
    expect(stored!.some((m) => m.flagged)).toBe(true);
    await snap(learner, testInfo, "4-private-details-removed");

    // ── stop; the lesson is finished and the home screen remembers it ────────────────────────
    await learner.getByRole("button", { name: buttons.stop }).click();
    await expect(learner.getByRole("heading", { name: "That lesson is finished" })).toBeVisible();
    await noHorizontalScroll(learner);
    await snap(learner, testInfo, "5-finished");

    await learner.getByRole("link", { name: "Back to my learning" }).click();
    await expect(learner).toHaveURL(/\/student$/);
    const recent = learner.getByRole("region", { name: "My recent work" });
    await expect(recent.getByText(/1 question,/)).toBeVisible();
    await expect(learner.getByText("When you finish a lesson, it will show up here.")).toHaveCount(
      0,
    );
    // what the home screen keeps is counts and outcomes: not a word of what was said
    await expect(learner.locator("main")).not.toContainText("carry the one");
    await noHorizontalScroll(learner);
    await snap(learner, testInfo, "6-home-after");

    // ── progress: the goal is no longer "not started" ───────────────────────────────────────
    await learner.getByRole("link", { name: "My progress", exact: true }).first().click();
    await expect(learner.getByRole("heading", { name: "My progress", level: 1 })).toBeVisible();
    // the sub-topic with work in it is open; the goal is there, and no longer "not started"
    const startedGoal = learner.getByRole("listitem").filter({ hasText: goalText }).first();
    await expect(startedGoal).toBeVisible();
    await expect(startedGoal).not.toContainText("Not started");
    await noHorizontalScroll(learner);
    await snap(learner, testInfo, "7-progress");
    await context.close();
  });

  test("a goal from a higher grade is not there for a younger child", async ({
    page,
    browser,
  }, testInfo) => {
    const id = unique();
    const username = `low${id}`.slice(0, 24);
    await signUpParent(page, "Mr Dube", `grade-${id}@example.test`);
    await addLearner(page, { name: "Tino", username, grade: 3 });
    const context = await browser.newContext(testInfo.project.use);
    const learner = await context.newPage();
    await signInLearner(learner, username);
    const response = await learner.goto("/student/learn/G7-NUM-WHOLE-NUMBERS-001");
    expect(response?.status()).toBe(404);
    await context.close();
  });

  test("a signed-out visitor cannot open a lesson, and a parent is not a learner", async ({
    page,
  }) => {
    await page.goto(`/student/learn/${GOAL}`);
    await expect(page).toHaveURL(/\/login\?.*next=/);

    const id = unique();
    await signUpParent(page, "Mrs Sibanda", `parent-only-${id}@example.test`);
    await page.goto(`/student/learn/${GOAL}`);
    await expect(page).toHaveURL(/\/parent/);
    await page.goto("/student/progress");
    await expect(page).toHaveURL(/\/parent/);
  });
});

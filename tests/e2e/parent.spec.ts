import { expect, test, type Page } from "@playwright/test";
import { finishOneLesson } from "./lesson-support";
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
 * A parent's view of a child: progress without conversations. The child says something distinctive in
 * a lesson; the parent must see that the lesson happened and how it went, and never the words.
 */

const GOAL = "G5-OPS-ADDITION-WHOLE-NUMBERS-001";
const SECRET = "zebra-pancake-secret";

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
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

test.describe("a parent's view of a child", () => {
  test("shows what the child did and how it went, and nothing they said", async ({
    page,
    browser,
  }, testInfo) => {
    const id = unique();
    const username = `par${id}`.slice(0, 24);
    await signUpParent(page, "Mrs Ncube", `view-${id}@example.test`);
    await addLearner(page, { name: "Rudo", username, grade: 5 });
    const learnerId = await learnerIdOf(username);

    // before any lesson: a clear, kind empty state
    await page.getByRole("link", { name: "See progress" }).click();
    await expect(page.getByRole("heading", { name: "Rudo", level: 1 })).toBeVisible();
    await expect(page.getByText("Rudo has not finished a lesson yet.")).toBeVisible();
    await expect(page.getByText("Nothing stands out right now.")).toBeVisible();
    await expect(page.getByText("No goal has been mastered yet.")).toBeVisible();
    await noHorizontalScroll(page);
    const parentUrl = page.url();

    // the child has a lesson and says something private-looking in a question of their own
    const context = await browser.newContext(testInfo.project.use);
    const child = await context.newPage();
    await signInLearner(child, username);
    await finishOneLesson(child, serviceClient(), learnerId, `/student/learn/${GOAL}`, {
      say: `why is it ${SECRET}?`,
    });
    await context.close();
    // it really was said and kept: the child's own conversation holds it
    const { data: said } = await serviceClient()
      .from("tutor_messages")
      .select("content")
      .eq("learner_id", learnerId)
      .like("content", `%${SECRET}%`);
    expect((said ?? []).length).toBe(1);

    await page.goto(parentUrl);
    await expect(page.getByText(/^1$/).first()).toBeVisible(); // one lesson this week
    await expect(page.getByText("Lesson finished", { exact: true })).toBeVisible();
    await expect(page.getByText("Day practised", { exact: true })).toBeVisible();
    const finished = page.getByRole("region", { name: /Lessons Rudo finished/ });
    await expect(finished.getByText(/1 question,/)).toBeVisible();
    await expect(page.getByText(/goals in Grade 5 that ZimTutor can practise/)).toBeVisible();
    await expect(page.getByText(/not exam marks/)).toBeVisible();
    await noHorizontalScroll(page);
    const photo = await page.screenshot({ fullPage: true });
    await testInfo.attach(`${testInfo.project.name}-parent-view`, {
      body: photo,
      contentType: "image/png",
    });

    // what the child typed or was told never reaches the parent's page
    await expect(page.locator("body")).not.toContainText("My answer");
    await expect(page.locator("body")).not.toContainText(SECRET);
    await expect(page.locator("body")).not.toContainText("ZimTutor practice question");
  });

  test("another family's child is not found", async ({ page, browser }, testInfo) => {
    const id = unique();
    const username = `oth${id}`.slice(0, 24);
    await signUpParent(page, "Mrs Moyo", `owner-${id}@example.test`);
    await addLearner(page, { name: "Kuda", username, grade: 4 });
    const learnerId = await learnerIdOf(username);

    const context = await browser.newContext(testInfo.project.use);
    const stranger = await context.newPage();
    await signUpParent(stranger, "Mr Stranger", `stranger-${id}@example.test`);
    const response = await stranger.goto(`/parent/learners/${learnerId}`);
    expect(response?.status()).toBe(404);
    const unknown = await stranger.goto("/parent/learners/not-an-id");
    expect(unknown?.status()).toBe(404);
    await context.close();

    // a learner cannot open a parent's page for themselves either
    const child = await (await browser.newContext(testInfo.project.use)).newPage();
    await signInLearner(child, username);
    await child.goto(`/parent/learners/${learnerId}`);
    await expect(child).toHaveURL(/\/student/);
  });
});

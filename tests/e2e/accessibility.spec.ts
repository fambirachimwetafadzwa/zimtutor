import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { buttons, readyForQuestion } from "./lesson-support";
import {
  addLearner,
  signInLearner,
  signUpAdmin,
  signUpParent,
  skipUnlessConfigured,
  unique,
} from "./support";

skipUnlessConfigured();

/**
 * An automated check of what a machine can judge about accessibility (WCAG 2.0 and 2.1, levels A and
 * AA): names and labels, roles, contrast, headings, landmarks, zoom. It is a floor, not an audit: it
 * cannot say whether a screen makes sense to someone using a screen reader, which only people can.
 *
 * The page is scanned with the Content Security Policy off for the checker's own script (the policy is
 * tested on its own, in security.spec.ts).
 */
test.use({ bypassCSP: true });

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

/** Every problem found on every page scanned in this test, so that one run shows them all. */
let problems: string[] = [];

async function scan(page: Page, where: string) {
  await page.waitForLoadState("networkidle");
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  for (const violation of results.violations)
    problems.push(
      `${where}: ${violation.impact} ${violation.id} (${violation.nodes.length}) ${violation.nodes
        .slice(0, 2)
        .map((node) => node.target.join(" "))
        .join(" | ")}`,
    );
}

test.beforeEach(() => {
  problems = [];
});
test.afterEach(() => {
  expect(problems, "accessibility problems").toEqual([]);
});

test.describe("accessibility, as far as a machine can tell", () => {
  test("the pages anyone can open", async ({ page }) => {
    for (const path of [
      "/",
      "/login",
      "/login?who=parent",
      "/signup",
      "/forgot-password",
      "/privacy",
    ]) {
      await page.goto(path);
      await scan(page, path);
    }
    await page.goto("/no-such-page");
    await scan(page, "the 404 page");
  });

  test("a parent's screens", async ({ page }) => {
    const id = unique();
    await signUpParent(page, "Mrs Chari", `a11y-parent-${id}@example.test`);
    await scan(page, "parent home, no learners");
    await page.goto("/parent/learners/new");
    await scan(page, "adding a learner");
    await addLearner(page, { name: "Farai", username: `a11y${id}`.slice(0, 24), grade: 5 });
    await scan(page, "parent home, one learner");
    await page.getByRole("link", { name: "See progress" }).click();
    await scan(page, "a child's progress");
    await page.getByText("Change Farai's password").click();
    await page.getByText("Delete Farai's account", { exact: true }).click();
    await scan(page, "a child's account, both panels open");
    await page.goto("/parent/account");
    await scan(page, "the parent's own account");
  });

  test("a learner's screens", async ({ page, browser }, testInfo) => {
    const id = unique();
    const username = `a11y${id}`.slice(0, 24);
    await signUpParent(page, "Mr Gumbo", `a11y-learner-${id}@example.test`);
    await addLearner(page, { name: "Tanaka", username, grade: 7 });
    const context = await browser.newContext({ ...testInfo.project.use, bypassCSP: true });
    const learner = await context.newPage();
    await signInLearner(learner, username);
    await scan(learner, "the learner's home");
    await learner
      .getByRole("region", { name: /Start something new/i })
      .getByRole("link")
      .click();
    await scan(learner, "a lesson before it is started");
    await learner.getByRole("button", { name: buttons.start }).click();
    await readyForQuestion(learner);
    await scan(learner, "a lesson with its first question");
    await learner.getByText("Ask ZimTutor a question").click();
    await scan(learner, "a lesson with the question box open");
    await learner.goto("/student/progress");
    await scan(learner, "progress");
    await learner.goto("/student/exams");
    await scan(learner, "practice papers");
    await learner
      .getByRole("button", { name: /Short paper: 20 multiple-choice questions/ })
      .click();
    await expect(learner).toHaveURL(/\/student\/exams\/[0-9a-f-]{36}$/);
    await scan(learner, "a practice paper");
    await context.close();
  });

  test("an administrator's screens", async ({ page }) => {
    await signUpAdmin(page, "a11y-admin");
    for (const path of [
      "/admin",
      "/admin/curriculum",
      "/admin/curriculum/objectives/G5-NUM-PROPER-FRACTIONS-004",
      "/admin/supplemental",
      "/admin/questions",
      // the pages of questions that carry pictures (tables, charts, clocks, rulers, shapes...)
      "/admin/questions?type=DATA_INTERPRETATION",
      "/admin/questions?type=VISUAL_DIAGRAM",
      "/admin/safety",
      "/admin/audit",
    ]) {
      await page.goto(path);
      await scan(page, path);
    }
  });
});

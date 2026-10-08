import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { SupabaseBankStore, getQuestionKey } from "../../src/lib/questions/bank";
import { toPublicQuestion } from "../../src/lib/questions/bank-rows";
import { fillAnswer } from "./lesson-support";
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
 * Practice papers in a browser: choosing a paper, writing it over several visits, finishing it, and the
 * result -- always called a practice score. A paper has many questions on one page, so every answer is
 * given inside the box of the question it belongs to.
 */

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
}

async function snap(page: Page, testInfo: TestInfo, name: string, fullPage = false) {
  const body = await page.screenshot({ fullPage });
  await testInfo.attach(`${testInfo.project.name}-${name}`, { body, contentType: "image/png" });
  const folder = process.env.E2E_SCREENSHOTS;
  if (folder) {
    await mkdir(folder, { recursive: true });
    await writeFile(path.join(folder, `${testInfo.project.name}-${name}.png`), body);
  }
}

/** One box per question of the paper (each part's own picture-and-words card is an article too, but has no name). */
const questionBoxes = (page: Page) =>
  page.getByRole("article", { name: /^Question (?:[AB])?\d+$/ });

async function learnerIdOf(username: string): Promise<string> {
  const { data, error } = await serviceClient()
    .from("learner_profiles")
    .select("profile_id")
    .eq("username", username)
    .single();
  if (error || !data) throw new Error(`no learner ${username}: ${error?.message}`);
  return data.profile_id as string;
}

/** The right answer to a part, by its position in the paper, and the question as the child sees it. */
async function partAt(setId: string, position: number) {
  const service = serviceClient();
  const { data } = await service
    .from("assessment_set_items")
    .select("question_id")
    .eq("set_id", setId)
    .eq("position", position)
    .single();
  const bank = new SupabaseBankStore(service);
  const id = data!.question_id as string;
  const [key, row] = await Promise.all([getQuestionKey(bank, id), bank.question(id)]);
  return { key: key!, question: toPublicQuestion(row!) };
}

/** Answer one part of the paper inside its question box and save it. */
async function answerPart(box: Locator, setId: string, position: number) {
  const { key, question } = await partAt(setId, position);
  const kind = await fillAnswer(box, key, question);
  if (kind !== "true-false")
    await box.getByRole("button", { name: /^(Save|Change) my answer$/ }).click();
  await expect(box.getByText(/^Saved: /).first()).toBeVisible();
}

async function newLearner(page: Page, testInfo: TestInfo, grade: number) {
  const id = unique();
  const username = `exm${id}`.slice(0, 24);
  await signUpParent(page, "Mrs Banda", `exam-${id}@example.test`);
  await addLearner(page, { name: "Kuda", username, grade });
  const context = await page.context().browser()!.newContext(testInfo.project.use);
  const learner = await context.newPage();
  await signInLearner(learner, username);
  return { learner, learnerId: await learnerIdOf(username), username, context };
}

test.describe("practice papers", () => {
  test("a short multiple-choice paper, written over two visits, marked once, and listed for the parent", async ({
    page,
  }, testInfo) => {
    const { learner, learnerId, context } = await newLearner(page, testInfo, 7);

    // choosing: the shape comes from the syllabus, and the mark is called what it is
    await learner.goto("/student/exams");
    await expect(learner.getByRole("heading", { name: "Practice papers", level: 1 })).toBeVisible();
    await expect(learner.getByText("ZimTutor practice score").first()).toBeVisible();
    await expect(learner.getByText(/not a ZIMSEC\s+result/)).toBeVisible();
    await expect(
      learner.getByText(/Revised Junior Mathematics Syllabus.*page/).first(),
    ).toBeVisible();
    await expect(
      learner.getByText(/40 multiple-choice questions, about 120 minutes/),
    ).toBeVisible();
    await expect(
      learner.getByText("When you finish a paper, it will be listed here."),
    ).toBeVisible();
    await noHorizontalScroll(learner);
    await snap(learner, testInfo, "exam-1-choose", true);

    await learner
      .getByRole("button", { name: /Short paper: 20 multiple-choice questions/ })
      .click();
    await expect(learner).toHaveURL(/\/student\/exams\/[0-9a-f-]{36}$/);
    const setId = learner.url().split("/").pop()!;
    await expect(learner.getByText("You have answered 0 of 20.")).toBeVisible();
    const boxes = questionBoxes(learner);
    await expect(boxes).toHaveCount(20);
    await expect(learner.locator("body")).not.toContainText(/Right answer|Explanation/);
    await noHorizontalScroll(learner);
    await snap(learner, testInfo, "exam-2-paper");

    // first visit: twelve answered, all right
    for (let position = 1; position <= 12; position++)
      await answerPart(boxes.nth(position - 1), setId, position);
    await expect(learner.getByText("You have answered 12 of 20.")).toBeVisible();

    // a second visit: the answers are still there, and a saved one can be changed
    await learner.goto("/student/exams");
    await expect(learner.getByText("You have a paper in progress")).toBeVisible();
    await expect(learner.getByRole("button", { name: /Short paper/ })).toHaveCount(0);
    await learner.getByRole("link", { name: "Carry on with my paper" }).click();
    await expect(learner.getByText("You have answered 12 of 20.")).toBeVisible();
    await expect(
      learner
        .getByRole("article")
        .first()
        .getByText(/^Saved: /),
    ).toBeVisible();
    await answerPart(questionBoxes(learner).nth(12), setId, 13);
    await expect(learner.getByText("You have answered 13 of 20.")).toBeVisible();

    // finishing asks first, and says what is left
    await learner.getByRole("button", { name: "Finish and mark my paper" }).click();
    await expect(learner.getByText(/You have not answered 7 questions/)).toBeVisible();
    await learner.getByRole("button", { name: "No, go back" }).click();
    await learner.getByRole("button", { name: "Finish and mark my paper" }).click();
    await learner.getByRole("button", { name: "Yes, mark it" }).click();

    // the result
    await expect(learner.getByText("Your practice score")).toBeVisible();
    await expect(learner.getByText(/out of 20/).first()).toBeVisible();
    await expect(learner.getByText(/It is not a ZIMSEC\s+mark/)).toBeVisible();
    await expect(
      learner.getByRole("heading", { name: "How you did on each kind of question" }),
    ).toBeVisible();
    await expect(learner.getByRole("heading", { name: "What to practise next" })).toBeVisible();
    await expect(learner.getByText(/7 questions were left\s+unanswered/)).toBeVisible();
    // the questions where marks were lost are open, with the answers and the reasons
    const opened = learner.locator("details[open]").first();
    await expect(opened.getByText("Your answer:")).toBeVisible();
    await expect(opened.getByText("Right answer:")).toBeVisible();
    await noHorizontalScroll(learner);
    await snap(learner, testInfo, "exam-3-result", true);

    // the paper is finished: it cannot be opened for writing again, and it is on the list
    await learner.goto("/student/exams");
    await expect(learner.getByText("When you finish a paper, it will be listed here.")).toHaveCount(
      0,
    );
    await expect(learner.getByText(/practice score/).first()).toBeVisible();
    await expect(learner.getByRole("button", { name: /Short paper/ })).toHaveCount(2);

    // the parent sees the practice score on their child's page
    await page.goto("/parent");
    await page.getByRole("link", { name: "See progress" }).click();
    const papers = page.getByRole("region", { name: "Practice papers" });
    await expect(papers.getByText(/Paper 1 style/)).toBeVisible();
    await expect(papers.getByText(/practice score/).first()).toBeVisible();
    await expect(page.locator("body")).not.toContainText(/Right answer|Your answer/);

    // what was answered went into the learner's record
    const { count } = await serviceClient()
      .from("question_attempts")
      .select("id", { count: "exact", head: true })
      .eq("learner_id", learnerId)
      .is("session_id", null);
    expect(count).toBe(13);
    await context.close();
  });

  test("a short structured paper has parts (a), (b), (c) and a choice in section B", async ({
    page,
  }, testInfo) => {
    const { learner, context } = await newLearner(page, testInfo, 7);
    await learner.goto("/student/exams");
    await learner.getByRole("button", { name: /Short paper: section A/ }).click();
    await expect(learner).toHaveURL(/\/student\/exams\/[0-9a-f-]{36}$/);
    const setId = learner.url().split("/").pop()!;
    await expect(learner.getByRole("heading", { name: "Section A", level: 2 })).toBeVisible();
    await expect(learner.getByRole("heading", { name: "Section B", level: 2 })).toBeVisible();
    await expect(learner.getByText(/Only your best 2 answers count/)).toBeVisible();
    await expect(learner.getByText("(a)").first()).toBeVisible();
    await expect(questionBoxes(learner)).toHaveCount(8); // 5 in section A, 3 in section B
    await noHorizontalScroll(learner);
    await snap(learner, testInfo, "exam-4-structured");

    // answer the first question of section A, part by part
    const first = questionBoxes(learner).first();
    const forms = await first.getByRole("button", { name: /^Save my answer$/ }).count();
    expect(forms).toBeGreaterThanOrEqual(1);
    for (let part = 1; part <= 2; part++) {
      const { data } = await serviceClient()
        .from("assessment_set_items")
        .select("position")
        .eq("set_id", setId)
        .eq("section", "A")
        .eq("question_number", 1)
        .eq("part", part)
        .maybeSingle();
      if (data) {
        const { key, question } = await partAt(setId, data.position as number);
        const box = first
          .locator("div")
          .filter({ hasText: question.stem.slice(0, 20) })
          .last();
        const kind = await fillAnswer(box, key, question);
        if (kind !== "true-false")
          await box
            .getByRole("button", { name: /^(Save|Change) my answer$/ })
            .first()
            .click();
        await expect(first.getByText(/^Saved: /).first()).toBeVisible();
      }
    }
    await learner.getByRole("button", { name: "Finish and mark my paper" }).click();
    await learner.getByRole("button", { name: "Yes, mark it" }).click();
    await expect(learner.getByText("Your practice score")).toBeVisible();
    await expect(learner.getByRole("heading", { name: "Section A", level: 3 })).toBeVisible();
    await expect(learner.getByText(/out of 23/).first()).toBeVisible();
    await context.close();
  });

  test("someone else's paper is not found, and a parent cannot open the learner's papers", async ({
    page,
    browser,
  }, testInfo) => {
    const { learner, context } = await newLearner(page, testInfo, 6);
    await learner.goto("/student/exams");
    await learner
      .getByRole("button", { name: /Short paper: 20 multiple-choice questions/ })
      .click();
    await expect(learner).toHaveURL(/\/student\/exams\/[0-9a-f-]{36}$/);
    const url = learner.url();

    const otherPage = await (await browser.newContext(testInfo.project.use)).newPage();
    const other = await newLearner(otherPage, testInfo, 6);
    const response = await other.learner.goto(url);
    expect(response?.status()).toBe(404);
    expect((await other.learner.goto("/student/exams/not-an-id"))?.status()).toBe(404);
    await other.context.close();

    // signed-out visitors and parents are sent away
    const visitor = await (await browser.newContext(testInfo.project.use)).newPage();
    await visitor.goto(url);
    await expect(visitor).toHaveURL(/\/login/);
    await page.goto(url);
    await expect(page).toHaveURL(/\/parent/);
    await context.close();
  });
});

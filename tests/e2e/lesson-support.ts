import type { SupabaseClient } from "@supabase/supabase-js";
import { expect, type Locator, type Page } from "@playwright/test";
import { SupabaseBankStore, getQuestionKey } from "../../src/lib/questions/bank";
import { toPublicQuestion, type QuestionKey } from "../../src/lib/questions/bank-rows";
import type { LearnerAnswer } from "../../src/lib/marking/spec";

/**
 * Helpers for browser tests that work through a lesson like a child would: read the screen, fill in
 * the form that is there, press the button. The only thing taken from outside the browser is the
 * RIGHT answer (read with the service key, which a child's browser never has), so a test can answer
 * correctly -- or choose to answer wrongly.
 */

/** Number groups are kept together with no-break spaces; a test compares plain text. */
const SPACES = new RegExp(`[${String.fromCharCode(0xa0)}${String.fromCharCode(0x202f)}]`, "g");
const plain = (text: string) => text.replace(SPACES, " ").trim();

/** The key of the question the learner is looking at: the latest question asked of them. */
export async function openQuestion(service: SupabaseClient, learnerId: string) {
  const { data, error } = await service
    .from("tutor_messages")
    .select("question_id, seq")
    .eq("learner_id", learnerId)
    .eq("kind", "QUESTION")
    .order("seq", { ascending: false })
    .limit(1);
  if (error || !data?.[0]) throw new Error(`no open question: ${error?.message ?? "none asked"}`);
  const bank = new SupabaseBankStore(service);
  const id = data[0].question_id as string;
  const key = await getQuestionKey(bank, id);
  const row = await bank.question(id);
  if (!key || !row) throw new Error(`question ${id} not found`);
  return { key, question: toPublicQuestion(row) };
}

/**
 * Put the answer into whatever form is on screen. Does not press "Check my answer". `page` may be one
 * question's own box on a page that holds many (a practice paper).
 */
export async function fillAnswer(
  page: Page | Locator,
  key: QuestionKey,
  question: ReturnType<typeof toPublicQuestion>,
  answer: LearnerAnswer = key.display,
): Promise<"typed" | "choice" | "true-false" | "boxes" | "ordering" | "matching"> {
  if (typeof answer === "boolean") {
    await page.getByRole("button", { name: answer ? "True" : "False", exact: true }).click();
    return "true-false";
  }
  if (typeof answer === "string") {
    if (question.answerKind === "CHOICE") {
      // press the whole option, as a finger would, rather than the small circle
      await page.locator(`label:has(input[type="radio"][value="${answer}"])`).click();
      return "choice";
    }
    await page.getByLabel("Your answer", { exact: true }).fill(answer);
    return "typed";
  }
  if (Array.isArray(answer)) {
    // ordering: bubble each item up to its place with the arrow buttons
    const rows = page.locator("form ol > li");
    const items = rows.locator("span.grow");
    for (let guard = 0; guard < 200; guard++) {
      const current = (await items.allInnerTexts()).map(plain);
      const wrongAt = current.findIndex((item, i) => item !== plain(answer[i] ?? ""));
      if (wrongAt === -1) break;
      const from = current.indexOf(plain(answer[wrongAt] ?? ""));
      if (from === -1) throw new Error(`cannot find "${answer[wrongAt]}" among ${current}`);
      await rows.nth(from).getByRole("button", { name: /up$/ }).click();
    }
    return "ordering";
  }
  if (question.matching) {
    const selects = page.locator("form select");
    const count = await selects.count();
    for (let i = 0; i < count; i++) {
      const select: Locator = selects.nth(i);
      const id = await select.getAttribute("id");
      const label = plain(await page.locator(`label[for="${id}"]`).innerText());
      const left = Object.keys(answer).find((k) => plain(k) === label);
      if (left === undefined) throw new Error(`no answer for "${label}"`);
      await select.selectOption(String(answer[left]));
    }
    return "matching";
  }
  // several boxes, in the order of the question's answer fields
  const fields = question.answerFields ?? [];
  for (const [i, field] of fields.entries()) {
    await page
      .locator("form input[type='text'], form input:not([type])")
      .nth(i)
      .fill(String(answer[field.id]));
  }
  return "boxes";
}

/** The names the screen gives the main buttons. */
export const buttons = {
  start: "Start",
  next: "Next",
  nextQuestion: "Next question",
  check: "Check my answer",
  hint: /Give me a hint/,
  showMe: "Show me how",
  different: "A different question",
  explain: "Explain it again",
  stop: "Stop for now",
} as const;

/** Press "Check my answer" unless the form has already sent the answer (true/false buttons). */
export async function submit(page: Page, kind: Awaited<ReturnType<typeof fillAnswer>>) {
  if (kind !== "true-false") await page.getByRole("button", { name: buttons.check }).click();
}

/** Click "Next" until a question is waiting for an answer. */
export async function readyForQuestion(page: Page) {
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

/**
 * Work one question the way a child would, start to finish: open the goal, press Start, go through
 * the explanation and example, answer the first question rightly and leave the lesson.
 */
export async function finishOneLesson(
  page: Page,
  service: SupabaseClient,
  learnerId: string,
  goalPath: string,
  options: { say?: string } = {},
) {
  await page.goto(goalPath);
  await page.getByRole("button", { name: buttons.start }).click();
  await readyForQuestion(page);
  const { key, question } = await openQuestion(service, learnerId);
  const kind = await fillAnswer(page, key, question);
  await submit(page, kind);
  await expect(page.getByRole("button", { name: buttons.nextQuestion })).toBeVisible();
  if (options.say) {
    // a question of their own, in their own words
    await page.getByText("Ask ZimTutor a question").click();
    await page.getByRole("textbox", { name: /Type your question/ }).fill(options.say);
    await page.getByRole("button", { name: "Send", exact: true }).click();
    // the words appear in the conversation, or -- when they held a phone number -- the same words
    // with the number replaced by [removed]
    const conversation = page.getByRole("list", { name: "Your lesson so far" });
    await expect(
      conversation.getByText(options.say).or(conversation.getByText("[removed]")),
    ).toBeVisible();
  }
  await page.getByRole("button", { name: buttons.stop }).click();
  await expect(page.getByRole("heading", { name: "That lesson is finished" })).toBeVisible();
}

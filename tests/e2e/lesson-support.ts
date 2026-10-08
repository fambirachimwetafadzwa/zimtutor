import type { SupabaseClient } from "@supabase/supabase-js";
import type { Locator, Page } from "@playwright/test";
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

/** Put the answer into whatever form is on screen. Does not press "Check my answer". */
export async function fillAnswer(
  page: Page,
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
      await page
        .locator("label", { has: page.locator(`input[type="radio"][value="${answer}"]`) })
        .click();
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

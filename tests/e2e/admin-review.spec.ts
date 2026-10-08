import { expect, test } from "@playwright/test";
import { finishOneLesson } from "./lesson-support";
import {
  addLearner,
  serviceClient,
  signInLearner,
  signUpAdmin,
  signUpParent,
  skipUnlessConfigured,
  unique,
} from "./support";

skipUnlessConfigured();

const GOAL = "G5-OPS-ADDITION-WHOLE-NUMBERS-001";

async function learnerIdOf(username: string): Promise<string> {
  const { data, error } = await serviceClient()
    .from("learner_profiles")
    .select("profile_id")
    .eq("username", username)
    .single();
  if (error || !data) throw new Error(`no learner ${username}: ${error?.message}`);
  return data.profile_id as string;
}

test.describe("an administrator's review of flagged messages and practice questions", () => {
  test("a flagged message is read, decided and audited; a question is approved and shows as checked", async ({
    page,
    browser,
  }, testInfo) => {
    const id = unique();
    const username = `adm${id}`.slice(0, 24);
    // earlier runs leave flagged messages behind: a token in the words picks out this one
    const token = `ref${id}`;
    // a family whose child has a lesson and writes something with a phone number in it
    const family = await (await browser.newContext(testInfo.project.use)).newPage();
    await signUpParent(family, "Mrs Zulu", `family-${id}@example.test`);
    await addLearner(family, { name: "Anesu", username, grade: 5 });
    const learnerId = await learnerIdOf(username);
    const child = await (await browser.newContext(testInfo.project.use)).newPage();
    await signInLearner(child, username);
    await finishOneLesson(child, serviceClient(), learnerId, `/student/learn/${GOAL}`, {
      say: `my number is 0771234567 ${token}`,
    });

    await signUpAdmin(page, "review");

    // the admin home says what is waiting
    await page.goto("/admin");
    const waiting = page.getByRole("region", { name: "Waiting for you" });
    await expect(waiting.getByText("Flagged messages to look at")).toBeVisible();
    await expect(waiting.getByText("Practice questions not yet checked")).toBeVisible();

    // the flagged message: the number is gone, the learner is named, the rest of the lesson is not shown
    await page.goto("/admin/safety");
    await expect(page.getByRole("heading", { name: "Flagged messages", level: 1 })).toBeVisible();
    const card = page.getByRole("listitem").filter({ hasText: token });
    await expect(card).toContainText("Shared personal details");
    await expect(card).toContainText("[removed]");
    await expect(page.locator("body")).not.toContainText("0771234567");
    await expect(page.locator("body")).not.toContainText("ZimTutor practice question");

    // deciding needs a choice; then it is saved and shown
    await card.getByRole("button", { name: "Save my decision" }).click();
    await expect(card.getByText("Choose what you decided.")).toBeVisible();
    await card.getByLabel("Your decision").selectOption("NO_CONCERN");
    await card.getByLabel("Note (optional)").fill("A phone number, removed. Nothing more to do.");
    await card.getByRole("button", { name: "Save my decision" }).click();
    // saved: the card now says what was decided (and moves below the ones still waiting)
    await expect(card).toContainText("No concern: nothing needs doing");
    await page.reload();
    const reviewed = page.getByRole("listitem").filter({ hasText: token });
    await expect(reviewed).toContainText("No concern: nothing needs doing");
    await expect(reviewed).toContainText("A phone number, removed. Nothing more to do.");

    // the audit log has the decision and never the child's words
    await page.goto("/admin/audit");
    await expect(page.getByText("Reviewed a flagged message").first()).toBeVisible();
    await expect(page.locator("body")).not.toContainText("0771234567");

    // practice questions: find this child's, approve it, and see it labelled as checked
    await page.goto(`/admin/questions?verification=UNVERIFIED&objective=${GOAL}`);
    await expect(page.getByRole("heading", { name: "Practice questions", level: 1 })).toBeVisible();
    const first = page.getByRole("listitem").filter({ hasText: "Right answer:" }).first();
    await expect(first).toContainText("Not yet checked");
    await expect(first).toContainText(GOAL);
    await first.getByRole("button", { name: "Approve" }).click();
    await page.goto(`/admin/questions?verification=ADMIN_REVIEWED&objective=${GOAL}`);
    const approved = page.getByRole("listitem").filter({ hasText: "Right answer:" }).first();
    await expect(approved).toContainText("Checked by a teacher");
    await expect(approved.getByRole("button", { name: "Reject and retire" })).toBeVisible();
    await page.goto("/admin/audit");
    await expect(page.getByText("Approved a practice question").first()).toBeVisible();
  });

  test("only administrators open these pages", async ({ page }) => {
    await signUpParent(page, "Mr Parent", `review-parent-${unique()}@example.test`);
    for (const path of ["/admin/safety", "/admin/questions"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/parent/);
    }
  });
});

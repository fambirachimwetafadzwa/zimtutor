import { defineConfig, devices } from "@playwright/test";

/**
 * Browser tests of the real application against a real Supabase stack.
 *
 * They need: the app running (`npm run build && npm start`, built with the Supabase settings of the
 * stack under test) at E2E_BASE_URL, plus INTEGRATION_SUPABASE_URL / _ANON_KEY / _SERVICE_ROLE_KEY
 * (the specs create their own users and promote their own administrator through the API), and the
 * migrations + curriculum loaded. Without E2E_BASE_URL every spec is skipped.
 *
 *   E2E_BASE_URL=http://localhost:3000 npm run e2e
 */
export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    // Learners use phones and cheap tablets: every flow must work on a narrow screen too.
    { name: "phone", use: { ...devices["Pixel 7"] } },
  ],
});

import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": `${root}src`,
      // `server-only` throws when imported outside a React Server Component bundle; stub it for tests.
      "server-only": `${root}tests/support/server-only-stub.ts`,
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    coverage: {
      provider: "v8",
      include: ["src/lib/**/*.ts", "src/ingestion/**/*.ts"],
      reporter: ["text-summary", "lcov"],
    },
  },
});

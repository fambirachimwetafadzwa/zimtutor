import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // `server-only` throws when imported outside a React Server Component bundle; stub it for tests.
      "server-only": path.resolve(__dirname, "tests/support/server-only-stub.ts"),
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

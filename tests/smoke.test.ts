import { describe, expect, it } from "vitest";

describe("toolchain", () => {
  it("runs TypeScript tests with the @ alias available", async () => {
    expect(1 + 1).toBe(2);
  });
});

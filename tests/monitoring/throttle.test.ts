import { describe, expect, it } from "vitest";
import { Throttle } from "../../src/lib/monitoring/throttle";

function setup(options = { perKey: 3, total: 5, windowMs: 60_000 }) {
  const clock = { now: 1_000_000 };
  return { clock, throttle: new Throttle(options, () => clock.now) };
}

describe("a throttle on reports", () => {
  it("lets a kind of report through a few times, then holds it back", () => {
    const { throttle } = setup();
    expect([1, 2, 3, 4, 5].map(() => throttle.allow("same"))).toEqual([
      true,
      true,
      true,
      false,
      false,
    ]);
  });

  it("counts each kind on its own", () => {
    const { throttle } = setup();
    for (let i = 0; i < 5; i++) throttle.allow("a");
    expect(throttle.allow("b")).toBe(true);
  });

  it("caps the total however many kinds there are", () => {
    const { throttle } = setup();
    const results = ["a", "b", "c", "d", "e", "f", "g"].map((key) => throttle.allow(key));
    expect(results).toEqual([true, true, true, true, true, false, false]);
  });

  it("starts again when the window has passed", () => {
    const { throttle, clock } = setup();
    for (let i = 0; i < 4; i++) throttle.allow("a");
    expect(throttle.allow("a")).toBe(false);
    clock.now += 60_001;
    expect(throttle.allow("a")).toBe(true);
  });

  it("does not grow without bound when every report is of a new kind", () => {
    const { throttle, clock } = setup({ perKey: 1, total: 100_000, windowMs: 60_000 });
    for (let i = 0; i < 5_000; i++) {
      clock.now += 100;
      throttle.allow(`kind-${i}`);
    }
    // old kinds were forgotten along the way; a kind seen long ago is allowed again
    expect(throttle.allow("kind-0")).toBe(true);
    expect((throttle as unknown as { seen: Map<string, number[]> }).seen.size).toBeLessThan(1_000);
  });
});

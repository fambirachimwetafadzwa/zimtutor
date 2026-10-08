import { describe, expect, it } from "vitest";
import { mark, type MarkResult } from "../../src/lib/marking/mark";

/** The marker faces whatever a child (or an attacker) types: it must never throw and never hang. */

const SPECS: unknown[] = [
  { method: "EXACT_NUMERIC", value: "12.5", requireForm: "decimal" },
  { method: "EXPRESSION_EQUIVALENT", expression: "3 + 4 x 2" },
  { method: "EXPRESSION_EQUIVALENT", expression: "4305", kind: "expanded", terms: [4000, 300, 5] },
  { method: "FRACTION_EQUIVALENT", value: "3/4" },
  { method: "FRACTION_LOWEST_TERMS", value: "3/4" },
  { method: "NUMERIC_WITH_UNIT", value: "2.5", unit: "kg" },
  { method: "MULTIPLE_CHOICE", correct: ["B"] },
  { method: "TRUE_FALSE", value: true },
  { method: "ORDERED_SEQUENCE", sequence: ["1", "2", "3"] },
  { method: "MATCHING_PAIRS", pairs: { a: "x", b: "y" } },
  { method: "TEXT_NORMALISED", accepted: ["triangle"] },
  {
    method: "MULTI_PART",
    parts: [
      { id: "a", marks: 1, spec: { method: "EXACT_NUMERIC", value: "1" } },
      { id: "b", marks: 1, spec: { method: "TEXT_NORMALISED", accepted: ["x"] } },
    ],
  },
  { method: "MANUAL_REVIEW" },
];

const STATUSES = ["CORRECT", "INCORRECT", "ALMOST", "INVALID_INPUT", "NEEDS_REVIEW"];

// A small deterministic generator, so a failure can be reproduced.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32;
}

const ALPHABET = "0123456789.,/ -+×÷x()%$°²³½¾ abcxyzABC€¢\n\t\"'`;:=<>&^!?*[]{}\\|~_";

function randomText(next: () => number): string {
  const length = Math.floor(next() * 40);
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[Math.floor(next() * ALPHABET.length)];
  return out;
}

function expectValid(result: MarkResult) {
  expect(STATUSES).toContain(result.status);
  expect(result.score).toBeGreaterThanOrEqual(0);
  expect(result.score).toBeLessThanOrEqual(1);
  expect(result.correct).toBe(result.status === "CORRECT");
  expect(() => JSON.stringify(result)).not.toThrow();
}

describe("marking robustness", () => {
  it("never throws on random text, whatever the method", () => {
    const next = rng(12345);
    for (const spec of SPECS) {
      for (let i = 0; i < 400; i++) {
        const text = randomText(next);
        expectValid(mark(spec, text));
        expectValid(mark(spec, [text, randomText(next)]));
        expectValid(mark(spec, { a: text, b: randomText(next) }));
      }
    }
  });

  it("handles answers of the wrong type", () => {
    for (const spec of SPECS) {
      for (const answer of [true, false, [], {}, [""], { a: {} }, "" as never]) {
        expectValid(mark(spec, answer as never));
      }
    }
  });

  it("stays fast on pathological input", () => {
    const hostile = [
      "1 ".repeat(20000),
      "9".repeat(100_000),
      "(".repeat(20000),
      "a".repeat(100_000),
      "1/".repeat(10000),
      "1,".repeat(10000),
      "1.".repeat(10000),
      " ".repeat(50000),
      "5 kg ".repeat(5000),
      "-".repeat(50000),
    ];
    const started = performance.now();
    for (const spec of SPECS) for (const text of hostile) expectValid(mark(spec, text));
    // The point is to catch super-linear blow-ups (minutes, not seconds); the budget is generous so
    // a slow or busy machine does not fail the build.
    expect(performance.now() - started).toBeLessThan(15_000);
  });
});

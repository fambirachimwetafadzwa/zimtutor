import { describe, expect, it } from "vitest";
import { generateQuestion } from "../../src/lib/questions/generate";
import { PLACE_NAMES } from "../../src/lib/questions/kit";
import { CONVERSIONS, singular } from "../../src/lib/questions/templates/time";
import { trueFalseTemplates } from "../../src/lib/questions/templates/true-false";
import { isMisconceptionCode } from "../../src/lib/misconceptions/registry";
import { DIFFICULTIES, OBJECTIVES } from "./support";

/**
 * True or false questions. Each statement is read back from the stem and checked by an independent
 * calculation, so a template that calls a false statement true (or the reverse) cannot pass.
 */

// numbers are printed with no-break spaces between groups of three digits
const SPACES = new RegExp(`[\\s${String.fromCharCode(0xa0)}${String.fromCharCode(0x202f)}]`, "g");
const digitsOnly = (text: string) => Number(text.replace(SPACES, ""));
const decimal = (text: string) => Number(text.replace(SPACES, ""));
const MINUS = String.fromCharCode(0x2212);

const num = "([\\d\\s" + String.fromCharCode(0xa0, 0x202f) + "]+)";

type Reader = (statement: string) => boolean;

const readers: Record<string, Reader> = {
  "ops.tf-sums": (s) => {
    const m = new RegExp(`^${num}\\s([+${MINUS}])\\s${num}\\s=\\s${num}$`).exec(s)!;
    const [a, b, c] = [digitsOnly(m[1]!), digitsOnly(m[3]!), digitsOnly(m[4]!)];
    return (m[2] === "+" ? a + b : a - b) === c;
  },
  "ops.tf-times": (s) => {
    const m = /^(\d+) × (\d+) = (\d+)$/.exec(s)!;
    return Number(m[1]) * Number(m[2]) === Number(m[3]);
  },
  "num.tf-place-value": (s) => {
    const worth = new RegExp(`^In ${num}, the digit (\\d) is worth ${num}\\.$`).exec(s);
    if (worth) {
      const n = digitsOnly(worth[1]!);
      const digit = Number(worth[2]);
      const at = String(n).indexOf(String(digit));
      const place = String(n).length - 1 - at;
      return digit * 10 ** place === digitsOnly(worth[3]!);
    }
    const inPlace = new RegExp(`^In ${num}, the digit (\\d) is in the (.+) place\\.$`).exec(s)!;
    const n = digitsOnly(inPlace[1]!);
    const at = String(n).indexOf(inPlace[2]!);
    return PLACE_NAMES[String(n).length - 1 - at] === inPlace[3];
  },
  "num.tf-compare": (s) => {
    const m = new RegExp(`^${num}\\s([<>])\\s${num}$`).exec(s)!;
    const [a, b] = [digitsOnly(m[1]!), digitsOnly(m[3]!)];
    return m[2] === "<" ? a < b : a > b;
  },
  "frac.tf-equivalent": (s) => {
    const m = /^(\d+)\/(\d+) = (\d+)\/(\d+)$/.exec(s)!;
    return Number(m[1]) * Number(m[4]) === Number(m[3]) * Number(m[2]);
  },
  "mea.tf-mass-capacity": (s) => {
    const quantity = `([\\d.\\s${String.fromCharCode(0xa0, 0x202f)}]+)`;
    const left = new RegExp(`^${quantity} (kg|l) = ${quantity} (g|ml)$`).exec(s);
    if (left) return decimal(left[1]!) * 1000 === decimal(left[3]!);
    const right = new RegExp(`^${quantity} (g|ml) = ${quantity} (kg|l)$`).exec(s)!;
    return decimal(right[1]!) === decimal(right[3]!) * 1000;
  },
  "mea.tf-time": (s) => {
    const m = new RegExp(`^${num} ([a-z]+) = ${num} ([a-z]+)$`).exec(s)!;
    const first = { value: digitsOnly(m[1]!), unit: m[2]! };
    const second = { value: digitsOnly(m[3]!), unit: m[4]! };
    for (const c of CONVERSIONS) {
      const bigger = c.op === "multiply" ? c.from : c.to;
      const smaller = c.op === "multiply" ? c.to : c.from;
      const isBigger = (unit: string) => unit === bigger || unit === singular(bigger);
      if (isBigger(first.unit) && second.unit === smaller)
        return first.value * c.per === second.value;
      if (isBigger(second.unit) && first.unit === smaller)
        return second.value * c.per === first.value;
    }
    throw new Error(`unknown conversion in "${s}"`);
  },
};

describe("true or false templates", () => {
  it("has a reader for every template (so every statement is checked)", () => {
    expect(trueFalseTemplates.map((t) => t.id).sort()).toEqual(Object.keys(readers).sort());
  });

  describe.each(trueFalseTemplates.map((t) => [t.id, t] as const))("%s", (id, template) => {
    const objectives = OBJECTIVES.filter((o) => template.covers(o));

    it("covers some objectives", () => {
      expect(objectives.length).toBeGreaterThan(0);
    });

    it("says what is true, and only that, on every objective and level", () => {
      const read = readers[id]!;
      let trues = 0;
      let falses = 0;
      for (const objective of objectives) {
        for (const difficulty of DIFFICULTIES) {
          for (let i = 0; i < 25; i++) {
            const q = generateQuestion({
              objective,
              difficulty,
              seed: `tf-${i}`,
              templates: [template],
            });
            const where = `${objective.id} d${difficulty} seed ${i}: ${q.stem}`;
            expect(q.type, where).toBe("TRUE_FALSE");
            expect(q.marking.method, where).toBe("TRUE_FALSE");
            const statement = q.stem.replace(/^True or false\?\s+/, "").trim();
            const truth = read(statement);
            expect(q.correctAnswer, where).toBe(truth);
            if (q.marking.method === "TRUE_FALSE") expect(q.marking.value, where).toBe(truth);

            // the explanation agrees, and the hints never give the verdict away
            expect(q.explanation, where).toMatch(
              truth ? /statement is true\.?$/ : /statement is false\.?$/,
            );
            for (const hint of q.hints) expect(hint, where).not.toMatch(/\b(?:true|false)\b/i);

            // a slip is recorded only on the wrong answer a child would give to a false statement
            for (const [answer, tag] of Object.entries(q.distractorMap)) {
              expect(answer, where).toBe(String(!truth));
              expect(isMisconceptionCode(tag), `${where} → ${tag}`).toBe(true);
            }
            if (truth) expect(Object.keys(q.distractorMap), where).toEqual([]);
            if (truth) trues++;
            else falses++;
          }
        }
      }
      // roughly half true, half false
      const share = trues / (trues + falses);
      expect(share).toBeGreaterThan(0.35);
      expect(share).toBeLessThan(0.65);
    });

    it("does not always make the same statement", () => {
      const seen = new Set<string>();
      const objective = objectives[0]!;
      for (let i = 0; i < 60; i++)
        seen.add(
          generateQuestion({ objective, difficulty: 3, seed: `var-${i}`, templates: [template] })
            .stem,
        );
      expect(seen.size).toBeGreaterThanOrEqual(8);
    });
  });
});

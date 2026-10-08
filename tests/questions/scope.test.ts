import { describe, expect, it } from "vitest";
import { generateQuestion } from "../../src/lib/questions/generate";
import { ALL_TEMPLATES } from "../../src/lib/questions/templates";
import type {
  GeneratedQuestion,
  ObjectiveInfo,
  QuestionTemplate,
} from "../../src/lib/questions/types";
import { DIFFICULTIES, OBJECTIVES } from "./support";

/**
 * Scope tests: a question must stay inside what the syllabus lists for the grade it is asked in
 * (its Content column). These limits are written here independently of the templates, straight from
 * the syllabus text, so a template that drifts outside them fails.
 */

const SEEDS = 10;

interface Generated {
  objective: ObjectiveInfo;
  difficulty: number;
  question: GeneratedQuestion;
}

function questionsFor(match: (template: QuestionTemplate) => boolean): Generated[] {
  const out: Generated[] = [];
  for (const template of ALL_TEMPLATES.filter(match)) {
    for (const objective of OBJECTIVES.filter((o) => template.covers(o))) {
      for (const difficulty of DIFFICULTIES) {
        if (template.levels && !template.levels.includes(difficulty)) continue;
        for (let i = 0; i < SEEDS; i++) {
          out.push({
            objective,
            difficulty,
            question: generateQuestion({
              objective,
              difficulty,
              seed: `scope-${i}`,
              templates: ALL_TEMPLATES,
              templateId: template.id,
            }),
          });
        }
      }
    }
  }
  return out;
}

const startsWith =
  (...prefixes: string[]) =>
  (t: QuestionTemplate) =>
    prefixes.some((p) => t.id.startsWith(p));
const ids =
  (...list: string[]) =>
  (t: QuestionTemplate) =>
    list.includes(t.id);

/** What the learner is given to read: stem, options, items, columns and picture data. */
const given = (q: GeneratedQuestion): string =>
  [
    q.stem,
    ...(q.options?.map((o) => o.text) ?? []),
    ...(q.items ?? []),
    ...(q.matching ? [...q.matching.left, ...q.matching.right] : []),
    ...(q.stemData ? [JSON.stringify(q.stemData)] : []),
  ].join(" ");

/** Everything the learner may read, hints and explanation included. */
const everything = (q: GeneratedQuestion): string =>
  [given(q), ...q.hints, q.explanation].join(" ");

const where = (g: Generated) => `${g.objective.id} d${g.difficulty} (${g.question.templateId})`;

function check(generated: Generated[], problem: (g: Generated) => string | null): string[] {
  // a scope test over nothing would pass for the wrong reason
  expect(generated.length, "no questions were generated to check").toBeGreaterThan(20);
  const out: string[] = [];
  for (const g of generated) {
    const found = problem(g);
    if (found) out.push(`${where(g)}: ${found}`);
  }
  return [...new Set(out)].slice(0, 12);
}

// ── fractions ───────────────────────────────────────────────────────────────────────────────────

const multiplesOfFive = (to: number) =>
  Array.from({ length: Math.floor((to - 10) / 5) }, (_, i) => 15 + 5 * i);
const DENOMINATORS: Record<number, number[]> = {
  3: [2, 3, 4, 5, 6, 7, 8, 9, 10, 20],
  4: [2, 4, 5, 10, 20],
  5: [2, 3, 4, 5, 6, 7, 8, 9, 10, 20],
  6: [2, 3, 4, 5, 6, 7, 8, 9, 10, ...multiplesOfFive(50)],
  7: [2, 3, 4, 5, 6, 7, 8, 9, 10, ...multiplesOfFive(100)],
};
const MIXED_DENOMINATORS: Record<number, number[]> = {
  4: [2, 4, 5, 10],
  5: [2, 3, 4, 5, 6, 7, 8, 9, 10],
  6: [2, 3, 4, 5, 6, 7, 8, 9, 10],
  7: [2, 3, 4, 5, 6, 7, 8, 9, 10],
};

describe("fractions", () => {
  const generated = questionsFor(startsWith("frac."));
  it("use only the denominators the syllabus lists for the grade", () => {
    const problems = check(generated, (g) => {
      const mixed = /mixed|improper/.test(g.objective.text) || /mixed/.test(g.question.templateId);
      const allowed = mixed
        ? (MIXED_DENOMINATORS[g.objective.grade] ?? DENOMINATORS[g.objective.grade]!)
        : DENOMINATORS[g.objective.grade]!;
      const text = g.question.stem;
      const denominators = [...text.matchAll(/\b\d+\/(\d+)\b/g)].map((m) => Number(m[1]));
      if (g.question.stemData?.kind === "fraction-bar")
        denominators.push(g.question.stemData.parts);
      const bad = denominators.find(
        (d) => !allowed.includes(d) && !(mixed && DENOMINATORS[g.objective.grade]!.includes(d)),
      );
      return bad === undefined
        ? null
        : `denominator ${bad} is not listed for Grade ${g.objective.grade}`;
    });
    expect(problems).toEqual([]);
  });
});

// ── decimals ────────────────────────────────────────────────────────────────────────────────────

/** Decimal places the numbers in a question may have (Content: "up to one / two / three decimal places"). */
const DECIMAL_PLACES: Record<number, number> = { 4: 1, 5: 2, 6: 3, 7: 3 };

describe("decimals", () => {
  const generated = questionsFor(startsWith("dec.", "ops.decimal"));
  it("never go beyond the decimal places listed for the grade", () => {
    const problems = check(generated, (g) => {
      const limit = /denominators? 10 and 100/.test(g.objective.text)
        ? 2 // Grade 4 relates fractions with denominators 10 and 100 to decimals
        : g.question.templateId === "ops.decimal-multiply"
          ? 2 // "multiplicand of up to 2 decimal places, multiplier of up to 1" (product up to 3)
          : g.question.templateId === "ops.decimal-divide" && g.objective.grade <= 6
            ? 2
            : (DECIMAL_PLACES[g.objective.grade] ?? 3);
      const text = g.question.stem + " " + (g.question.options?.map((o) => o.text).join(" ") ?? "");
      const places = [...text.matchAll(/(?<![\d.])\d[\d ]*\.(\d+)(?!\d)/g)].map(
        (m) => m[1]!.length,
      );
      const worst = Math.max(0, ...places);
      return worst > limit ? `${worst} decimal places given, at most ${limit} allowed` : null;
    });
    expect(problems).toEqual([]);
  });
});

// ── Roman numerals ──────────────────────────────────────────────────────────────────────────────

const ROMAN_MAX: Record<number, number> = { 3: 10, 4: 50, 5: 20, 6: 50, 7: 50 };
const ROMAN_VALUE: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
function romanToNumber(text: string): number {
  let total = 0;
  for (let i = 0; i < text.length; i++) {
    const value = ROMAN_VALUE[text[i]!]!;
    total += value < (ROMAN_VALUE[text[i + 1]!] ?? 0) ? -value : value;
  }
  return total;
}

describe("Roman numerals", () => {
  const generated = questionsFor(ids("num.roman"));
  it("stay within the range the syllabus lists for the grade", () => {
    const problems = check(generated, (g) => {
      const max = ROMAN_MAX[g.objective.grade]!;
      const text = given(g.question);
      const romans = [...text.matchAll(/(?<![A-Za-z])[IVXLCDM]+(?![A-Za-z])/g)].map((m) => m[0]);
      const arabic = [...g.question.stem.matchAll(/(?<![\d.,])\d{1,3}(?![\d.,])/g)].map((m) =>
        Number(m[0]),
      );
      const tooBig =
        romans.find((r) => romanToNumber(r) > max) ?? arabic.find((n) => n > max)?.toString();
      return tooBig ? `"${tooBig}" is above ${max}` : null;
    });
    expect(problems).toEqual([]);
  });
});

// ── whole-number operations ─────────────────────────────────────────────────────────────────────

const SUM_LIMIT: Record<number, number> = {
  3: 1_000,
  4: 10_000,
  5: 100_000,
  6: 1_000_000,
  7: 10_000_000,
};
/** "product is 0 to 500" and "product is less than 1 000 / 5 000 / 10 000 / 100 000" (largest allowed product). */
const PRODUCT_LIMIT: Record<number, number> = {
  3: 500,
  4: 999,
  5: 4_999,
  6: 9_999,
  7: 99_999,
};
const DIVIDEND_LIMIT: Record<number, number> = {
  3: 100,
  4: 1_000,
  5: 10_000,
  6: 10_000,
  7: 100_000,
};
const numbersIn = (text: string): number[] =>
  [...text.replace(/(\d) (?=\d{3}\b)/g, "$1").matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));

describe("whole-number operations", () => {
  it("keep sums and differences within the range for the grade", () => {
    const problems = check(questionsFor(ids("ops.add-whole", "ops.subtract-whole")), (g) => {
      const limit = SUM_LIMIT[g.objective.grade]!;
      const biggest = Math.max(...numbersIn(g.question.stem));
      return biggest > limit ? `${biggest} is above ${limit}` : null;
    });
    expect(problems).toEqual([]);
  });

  it("keep products below the limit for the grade", () => {
    const problems = check(
      questionsFor(
        ids("ops.multiply-digit", "ops.multiply-tens", "ops.multiply-long", "ops.times-facts"),
      ),
      (g) => {
        const limit = PRODUCT_LIMIT[g.objective.grade]!;
        const answer = g.question.correctAnswer;
        if (typeof answer !== "string") return null;
        const value = Number(answer.replace(/\s/g, ""));
        return Number.isFinite(value) && value > limit && g.question.type !== "MULTIPLE_CHOICE"
          ? `the answer ${value} is above ${limit}`
          : null;
      },
    );
    expect(problems).toEqual([]);
  });

  it("keep dividends within the limit for the grade", () => {
    const problems = check(questionsFor(ids("ops.divide-whole", "ops.share-equally")), (g) => {
      const limit = DIVIDEND_LIMIT[g.objective.grade]!;
      const biggest = Math.max(...numbersIn(g.question.stem));
      return biggest > limit ? `${biggest} is above ${limit}` : null;
    });
    expect(problems).toEqual([]);
  });
});

// ── money ───────────────────────────────────────────────────────────────────────────────────────

/** "Currency up to $10.00", "Money up to $50", "$100", "$200", "$500". */
const MONEY_LIMIT: Record<number, number> = { 3: 10, 4: 50, 5: 100, 6: 200, 7: 500 };

describe("money", () => {
  const generated = questionsFor(startsWith("mea.money"));
  it("keeps amounts within the limit for the grade", () => {
    const problems = check(generated, (g) => {
      const limit = MONEY_LIMIT[g.objective.grade]!;
      const amounts = [...g.question.stem.matchAll(/\$(\d[\d ]*(?:\.\d+)?)/g)].map((m) =>
        Number(m[1]!.replace(/\s/g, "")),
      );
      const biggest = Math.max(0, ...amounts);
      return biggest > limit ? `$${biggest} is above $${limit}` : null;
    });
    expect(problems).toEqual([]);
  });
});

// ── shapes, circles and directions ──────────────────────────────────────────────────────────────

describe("shapes", () => {
  it("name only polygons within the grade's limit (Grade 3: 4 sides, Grade 5: 5, Grade 6: 10)", () => {
    const longNames = /\b(pentagon|hexagon|heptagon|octagon|nonagon|decagon)\b/i;
    const problems = check(questionsFor(ids("mea.polygon-names")), (g) => {
      const text = given(g.question);
      if (g.objective.grade <= 4 && longNames.test(text))
        return "a polygon with more than 4 sides is named";
      if (g.objective.grade === 5 && /\b(hexagon|heptagon|octagon|nonagon|decagon)\b/i.test(text))
        return "a polygon with more than 5 sides is named";
      return null;
    });
    expect(problems).toEqual([]);
  });

  it("keep Grades 3 and 4 to squares, rectangles, triangles and circles (kites and pentagons come in Grade 5)", () => {
    const problems = check(questionsFor(ids("mea.shape-knowledge", "mea.shape-patterns")), (g) =>
      g.objective.grade <= 4 && /\b(kite|pentagon)\b/i.test(everything(g.question))
        ? "a Grade 5 shape is used"
        : null,
    );
    expect(problems).toEqual([]);
  });

  it("do not mention the circumference in Grade 7 (the Grade 7 list of circle parts leaves it out)", () => {
    const problems = check(questionsFor(ids("mea.circle-parts")), (g) =>
      g.objective.grade === 7 && /circumference/i.test(everything(g.question))
        ? "the circumference is mentioned"
        : null,
    );
    expect(problems).toEqual([]);
  });
});

describe("direction and turns", () => {
  const diagonal = /\b(north|south)-?\s?(east|west)\b/i;
  it("use the four cardinal points in Grades 3 and 4 and the eight from Grade 5", () => {
    const pieces = (q: GeneratedQuestion) => [
      q.stem,
      ...(q.options?.map((o) => o.text) ?? []),
      ...(q.items ?? []),
      ...q.hints,
      q.explanation,
    ];
    const problems = check(questionsFor(ids("mea.cardinal", "mea.turns")), (g) =>
      g.objective.grade <= 4 && pieces(g.question).some((p) => diagonal.test(p))
        ? "one of the four extra points of the compass is used"
        : null,
    );
    expect(problems).toEqual([]);
  });

  it("ask for a quarter or half turn in Grade 3, adding the complete revolution in Grade 4 and three quarters in Grade 5", () => {
    const problems = check(questionsFor(ids("mea.turns")), (g) => {
      const correct = g.question.options?.find((o) => o.id === g.question.correctAnswer)?.text;
      if (!correct) return null;
      if (g.objective.grade === 3 && /three-quarter|complete/.test(correct))
        return `"${correct}" is not a Grade 3 answer`;
      if (g.objective.grade === 4 && /three-quarter/.test(correct))
        return `"${correct}" is not a Grade 4 answer`;
      return null;
    });
    expect(problems).toEqual([]);
  });
});

// ── time ────────────────────────────────────────────────────────────────────────────────────────

describe("time", () => {
  it("shows clock times to the hour, half hour and quarter hour in Grade 3 and to five minutes in Grade 4", () => {
    const problems = check(questionsFor(ids("mea.clock-read")), (g) => {
      const data = g.question.stemData;
      if (data?.kind !== "clock") return null;
      if (g.objective.grade === 3 && ![0, 15, 30, 45].includes(data.minute))
        return `Grade 3 clock shows ${data.minute} minutes`;
      if (g.objective.grade === 4 && data.minute % 5 !== 0)
        return `Grade 4 clock shows ${data.minute} minutes`;
      return null;
    });
    expect(problems).toEqual([]);
  });
});

// ── data handling ───────────────────────────────────────────────────────────────────────────────

describe("data handling", () => {
  it("meets pictographs from Grade 5 and pie-chart numbers from Grade 5", () => {
    const pictographGrades = new Set(
      OBJECTIVES.filter((o) => ALL_TEMPLATES.find((t) => t.id === "rel.pictograph")!.covers(o)).map(
        (o) => o.grade,
      ),
    );
    expect([...pictographGrades].sort()).toEqual([5, 6, 7]);
    const problems = check(questionsFor(ids("rel.pie-chart")), (g) => {
      const data = g.question.stemData;
      return g.objective.grade <= 4 && data?.kind === "pie-chart" && data.valueLabel !== "none"
        ? "a Grade 4 pie chart shows numbers"
        : null;
    });
    expect(problems).toEqual([]);
  });
});

// ── nothing official is claimed ─────────────────────────────────────────────────────────────────

describe("labelling", () => {
  it("never describes a generated question as official or as a ZIMSEC score", () => {
    const problems = check(
      questionsFor(() => true).filter((g) => g.difficulty % 2 === 1),
      (g) =>
        /ZIMSEC|official|Ministry|MoPSE/i.test(everything(g.question))
          ? "mentions an official body or calls itself official"
          : null,
    );
    expect(problems).toEqual([]);
  });
});

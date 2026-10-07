import { evaluateExpression, isSumOfTerms } from "./expression";
import {
  looksLikeExpression,
  parseLearnerNumber,
  writtenInLowestTerms,
  type ParsedNumber,
} from "./numbers";
import { Rational } from "./rational";
import {
  MarkingConfigError,
  parseMarkingSpec,
  type LearnerAnswer,
  type MarkingMethod,
  type MarkingSpec,
} from "./spec";
import { findUnit, parseQuantity, type UnitDef } from "./units";

/**
 * DETERMINISTIC MARKING. Correctness is decided here, by exact arithmetic and plain comparison —
 * never by a language model. (A model may later EXPLAIN a mark; it cannot change one.)
 *
 * Statuses
 *   CORRECT        full marks
 *   INCORRECT      wrong
 *   ALMOST         right idea, wrong presentation (missing unit, fraction not in lowest terms, decimal
 *                  where a fraction was asked): a retry with no penalty
 *   INVALID_INPUT  nothing markable was given (empty, not a number): ask again, no penalty
 *   NEEDS_REVIEW   cannot be marked by machine
 *
 * `detail` is stored with the attempt, which the learner can read: it therefore NEVER contains the
 * expected answer.
 */

export type MarkStatus = "CORRECT" | "INCORRECT" | "ALMOST" | "INVALID_INPUT" | "NEEDS_REVIEW";

export type MarkSignal =
  | "EMPTY"
  | "NOT_A_NUMBER"
  | "DIVISION_BY_ZERO"
  | "EXPRESSION_GIVEN"
  | "WRONG_FORM"
  | "NOT_IN_LOWEST_TERMS"
  | "MISSING_UNIT"
  | "WRONG_UNIT"
  | "UNIT_DIMENSION_MISMATCH"
  | "OFF_BY_POWER_OF_TEN"
  | "AMBIGUOUS_SEPARATOR_ACCEPTED"
  | "WITHIN_TOLERANCE"
  | "SEQUENCE_PARTIAL"
  | "PAIRS_PARTIAL"
  | "WRONG_SHAPE_OF_ANSWER";

export interface MarkResult {
  method: MarkingMethod;
  status: MarkStatus;
  correct: boolean;
  /** 0..1. Partial credit exists only for multi-part, ordering and matching questions. */
  score: number;
  signals: MarkSignal[];
  detail: Record<string, unknown>;
  parts?: Record<string, MarkResult>;
}

const result = (
  method: MarkingMethod,
  status: MarkStatus,
  score: number,
  signals: MarkSignal[] = [],
  detail: Record<string, unknown> = {},
): MarkResult => ({ method, status, correct: status === "CORRECT", score, signals, detail });

const invalid = (method: MarkingMethod, signal: MarkSignal, detail: Record<string, unknown> = {}) =>
  result(method, "INVALID_INPUT", 0, [signal], detail);

function expectedRational(text: string): Rational {
  const parsed = parseLearnerNumber(text);
  if (!parsed.ok || parsed.value.candidates.length !== 1) {
    throw new MarkingConfigError(`Expected value "${text}" is not an unambiguous number`);
  }
  return parsed.value.candidates[0]!;
}

function asString(answer: LearnerAnswer): string | null {
  return typeof answer === "string" ? answer : null;
}

/** 10^k (k ≠ 0, |k| ≤ 3) away from the expected value: the signature of a place-value / unit slip. */
export function powerOfTenDistance(given: Rational, expected: Rational): number | null {
  if (expected.isZero() || given.isZero()) return null;
  const ratio = given.div(expected);
  if (ratio.isNegative()) return null;
  for (let k = 1; k <= 3; k++) {
    const ten = Rational.of(10).pow(k);
    if (ratio.equals(ten)) return k;
    if (ratio.equals(Rational.ONE.div(ten))) return -k;
  }
  return null;
}

function describeParsed(p: ParsedNumber) {
  return { form: p.form, values: p.candidates.map((c) => c.toString()), ambiguous: p.ambiguous };
}

function formAccepted(required: string | undefined, p: ParsedNumber): boolean {
  if (!required) return true;
  switch (required) {
    case "integer":
      return p.form === "integer" || p.form === "words";
    case "decimal":
      return p.form === "integer" || p.form === "decimal" || p.form === "words";
    case "fraction":
      return p.form === "fraction" || p.form === "mixed";
    case "mixed":
      return p.form === "mixed" || p.form === "integer";
    case "percent":
      return true; // "25" and "25%" are both fine
    default:
      return true;
  }
}

// ── numeric ─────────────────────────────────────────────────────────────────────────────────────

function markExactNumeric(
  spec: Extract<MarkingSpec, { method: "EXACT_NUMERIC" }>,
  answer: LearnerAnswer,
): MarkResult {
  const text = asString(answer);
  if (text === null) return invalid("EXACT_NUMERIC", "WRONG_SHAPE_OF_ANSWER");
  const parsed = parseLearnerNumber(text);
  if (!parsed.ok) {
    const signal: MarkSignal =
      parsed.error === "EMPTY"
        ? "EMPTY"
        : parsed.error === "DIVISION_BY_ZERO"
          ? "DIVISION_BY_ZERO"
          : looksLikeExpression(text)
            ? "EXPRESSION_GIVEN"
            : "NOT_A_NUMBER";
    return invalid("EXACT_NUMERIC", signal, { reason: parsed.error });
  }
  const learner = parsed.value;
  const expected = [spec.value, ...(spec.alsoAccept ?? [])].map(expectedRational);
  const tolerance = spec.tolerance ? expectedRational(spec.tolerance).absValue() : null;

  const signals: MarkSignal[] = [];
  let matched = false;
  let matchedIndex = -1;
  let withinOnly = false;
  learner.candidates.forEach((candidate, index) => {
    for (const e of expected) {
      if (candidate.equals(e)) {
        matched = true;
        matchedIndex = index;
      } else if (tolerance && candidate.sub(e).absValue().compare(tolerance) <= 0 && !matched) {
        matched = true;
        matchedIndex = index;
        withinOnly = true;
      }
    }
  });
  const detail = { parsed: describeParsed(learner) };
  if (!matched) {
    const distance = learner.candidates
      .map((c) => powerOfTenDistance(c, expected[0]!))
      .find((d) => d !== null);
    if (distance !== undefined && distance !== null) signals.push("OFF_BY_POWER_OF_TEN");
    return result("EXACT_NUMERIC", "INCORRECT", 0, signals, {
      ...detail,
      powerOfTen: distance ?? null,
    });
  }
  if (learner.ambiguous && matchedIndex > 0) signals.push("AMBIGUOUS_SEPARATOR_ACCEPTED");
  if (withinOnly) signals.push("WITHIN_TOLERANCE");
  if (!formAccepted(spec.requireForm, learner))
    return result("EXACT_NUMERIC", "ALMOST", 0, [...signals, "WRONG_FORM"], detail);
  return result("EXACT_NUMERIC", "CORRECT", 1, signals, detail);
}

function markFraction(
  method: "FRACTION_EQUIVALENT" | "FRACTION_LOWEST_TERMS",
  spec: { value: string },
  answer: LearnerAnswer,
): MarkResult {
  const text = asString(answer);
  if (text === null) return invalid(method, "WRONG_SHAPE_OF_ANSWER");
  const parsed = parseLearnerNumber(text);
  if (!parsed.ok)
    return invalid(
      method,
      parsed.error === "EMPTY"
        ? "EMPTY"
        : parsed.error === "DIVISION_BY_ZERO"
          ? "DIVISION_BY_ZERO"
          : "NOT_A_NUMBER",
      { reason: parsed.error },
    );
  const learner = parsed.value;
  const expected = expectedRational(spec.value);
  const detail = { parsed: describeParsed(learner) };
  if (!learner.candidates.some((c) => c.equals(expected)))
    return result(method, "INCORRECT", 0, [], detail);
  // A fraction was asked for: a decimal with the right value is the right idea in the wrong form.
  if (
    learner.form !== "fraction" &&
    learner.form !== "mixed" &&
    !(learner.form === "integer" && expected.isInteger())
  ) {
    return result(method, "ALMOST", 0, ["WRONG_FORM"], detail);
  }
  if (method === "FRACTION_LOWEST_TERMS" && !writtenInLowestTerms(learner)) {
    return result(method, "ALMOST", 0, ["NOT_IN_LOWEST_TERMS"], detail);
  }
  return result(method, "CORRECT", 1, [], detail);
}

function markExpression(
  spec: Extract<MarkingSpec, { method: "EXPRESSION_EQUIVALENT" }>,
  answer: LearnerAnswer,
): MarkResult {
  const text = asString(answer);
  if (text === null) return invalid("EXPRESSION_EQUIVALENT", "WRONG_SHAPE_OF_ANSWER");
  const learner = evaluateExpression(text);
  if (!learner.ok)
    return invalid(
      "EXPRESSION_EQUIVALENT",
      learner.error === "EMPTY"
        ? "EMPTY"
        : learner.error === "DIVISION_BY_ZERO"
          ? "DIVISION_BY_ZERO"
          : "NOT_A_NUMBER",
      { reason: learner.error },
    );
  const expected = evaluateExpression(spec.expression);
  if (!expected.ok)
    throw new MarkingConfigError(
      `Expected expression "${spec.expression}" cannot be evaluated (${expected.error})`,
    );
  const detail = { value: learner.value.toString() };
  if (!learner.value.equals(expected.value))
    return result("EXPRESSION_EQUIVALENT", "INCORRECT", 0, [], detail);
  if (spec.kind === "expanded") {
    if (!spec.terms) throw new MarkingConfigError("An expanded-notation key needs its terms");
    if (!isSumOfTerms(text, spec.terms))
      return result("EXPRESSION_EQUIVALENT", "ALMOST", 0, ["WRONG_FORM"], detail);
  }
  return result("EXPRESSION_EQUIVALENT", "CORRECT", 1, [], detail);
}

function quantityOf(text: string) {
  return parseQuantity(text, (t) => {
    const p = parseLearnerNumber(t);
    return p.ok && p.value.candidates.length >= 1 ? p.value.candidates[0]! : null;
  });
}

function markWithUnit(
  spec: Extract<MarkingSpec, { method: "NUMERIC_WITH_UNIT" }>,
  answer: LearnerAnswer,
): MarkResult {
  const text = asString(answer);
  if (text === null) return invalid("NUMERIC_WITH_UNIT", "WRONG_SHAPE_OF_ANSWER");
  const unit = findUnit(spec.unit);
  if (!unit) throw new MarkingConfigError(`Unknown expected unit "${spec.unit}"`);
  const expectedValue = expectedRational(spec.value);
  const expectedBase = expectedValue.mul(unit.toBase);

  const parsed = quantityOf(text);
  if (!parsed.ok) {
    return invalid("NUMERIC_WITH_UNIT", parsed.reason === "EMPTY" ? "EMPTY" : "NOT_A_NUMBER", {
      reason: parsed.reason,
    });
  }
  const q = parsed.quantity;
  const detail = { value: q.value.toString(), unit: q.unit?.symbol ?? null };

  if (!q.unit) {
    if (!spec.unitOptional) {
      // The number alone is right → the idea is right; the unit is missing.
      return q.value.equals(expectedValue)
        ? result("NUMERIC_WITH_UNIT", "ALMOST", 0, ["MISSING_UNIT"], detail)
        : result("NUMERIC_WITH_UNIT", "INCORRECT", 0, [], detail);
    }
    return q.value.equals(expectedValue)
      ? result("NUMERIC_WITH_UNIT", "CORRECT", 1, [], detail)
      : numericMiss(q.value, expectedValue, detail);
  }

  if (q.unit.dimension !== unit.dimension) {
    return result("NUMERIC_WITH_UNIT", "INCORRECT", 0, ["UNIT_DIMENSION_MISMATCH"], detail);
  }
  if (q.unit.symbol === unit.symbol) {
    return q.value.equals(expectedValue)
      ? result("NUMERIC_WITH_UNIT", "CORRECT", 1, [], detail)
      : numericMiss(q.value, expectedValue, detail);
  }
  // Same dimension, different unit: the same quantity written another way.
  const sameQuantity = q.base!.equals(expectedBase);
  if (sameQuantity) {
    return spec.strictUnit
      ? result("NUMERIC_WITH_UNIT", "ALMOST", 0, ["WRONG_UNIT"], detail)
      : result("NUMERIC_WITH_UNIT", "CORRECT", 1, [], detail);
  }
  return result("NUMERIC_WITH_UNIT", "INCORRECT", 0, powerSignals(q.value, expectedValue), detail);
}

function numericMiss(
  given: Rational,
  expected: Rational,
  detail: Record<string, unknown>,
): MarkResult {
  return result("NUMERIC_WITH_UNIT", "INCORRECT", 0, powerSignals(given, expected), detail);
}
function powerSignals(given: Rational, expected: Rational): MarkSignal[] {
  return powerOfTenDistance(given, expected) !== null ? ["OFF_BY_POWER_OF_TEN"] : [];
}

// ── choices, text, sequences ────────────────────────────────────────────────────────────────────

export function normaliseText(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(a|an|the) /, "");
}

/**
 * "rectangles" matches "rectangle", "boxes" matches "box": whether a word is plural is not what is
 * being tested. Two words match if they share any spelling with a plural ending removed.
 */
function singulars(word: string): string[] {
  const forms = [word];
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) forms.push(word.slice(0, -1));
  if (word.length > 4 && word.endsWith("es")) forms.push(word.slice(0, -2));
  return forms;
}
const textKey = (text: string) => normaliseText(text);
function sameText(a: string, b: string): boolean {
  const x = textKey(a).split(" ");
  const y = textKey(b).split(" ");
  return (
    x.length === y.length &&
    x.every((word, i) => singulars(word).some((form) => singulars(y[i]!).includes(form)))
  );
}

function markChoice(
  spec: Extract<MarkingSpec, { method: "MULTIPLE_CHOICE" }>,
  answer: LearnerAnswer,
): MarkResult {
  const text = asString(answer);
  if (text === null) return invalid("MULTIPLE_CHOICE", "WRONG_SHAPE_OF_ANSWER");
  const picked = text
    .trim()
    .replace(/^\(?([A-Za-z0-9]{1,3})\)?[.)]?$/, "$1")
    .toUpperCase();
  if (picked === "") return invalid("MULTIPLE_CHOICE", "EMPTY");
  const correct = spec.correct.map((c) => c.toUpperCase());
  return correct.includes(picked)
    ? result("MULTIPLE_CHOICE", "CORRECT", 1, [], { picked })
    : result("MULTIPLE_CHOICE", "INCORRECT", 0, [], { picked });
}

function parseBoolean(answer: LearnerAnswer): boolean | null {
  if (typeof answer === "boolean") return answer;
  const text = asString(answer);
  if (text === null) return null;
  const t = normaliseText(text);
  if (["true", "t", "yes", "y", "correct", "right"].includes(t)) return true;
  if (["false", "f", "no", "n", "incorrect", "wrong"].includes(t)) return false;
  return null;
}

function markTrueFalse(
  spec: Extract<MarkingSpec, { method: "TRUE_FALSE" }>,
  answer: LearnerAnswer,
): MarkResult {
  const given = parseBoolean(answer);
  if (given === null)
    return invalid(
      "TRUE_FALSE",
      asString(answer)?.trim() === "" ? "EMPTY" : "WRONG_SHAPE_OF_ANSWER",
    );
  return given === spec.value
    ? result("TRUE_FALSE", "CORRECT", 1, [], { picked: given })
    : result("TRUE_FALSE", "INCORRECT", 0, [], { picked: given });
}

function sameItem(a: string, b: string): boolean {
  const x = parseLearnerNumber(a);
  const y = parseLearnerNumber(b);
  if (x.ok && y.ok && x.value.form !== "words" && y.value.form !== "words") {
    return x.value.candidates.some((c) => y.value.candidates.some((d) => c.equals(d)));
  }
  return sameText(a, b);
}

function markSequence(
  spec: Extract<MarkingSpec, { method: "ORDERED_SEQUENCE" }>,
  answer: LearnerAnswer,
): MarkResult {
  let items: string[] | null = null;
  if (Array.isArray(answer)) items = answer.map(String);
  else if (typeof answer === "string")
    items = answer.split(/\s*(?:,|;|→|->|<|>|\n)\s*/).filter((s) => s.trim() !== "");
  if (!items) return invalid("ORDERED_SEQUENCE", "WRONG_SHAPE_OF_ANSWER");
  if (items.length === 0) return invalid("ORDERED_SEQUENCE", "EMPTY");
  const n = spec.sequence.length;
  const inPlace = spec.sequence.filter(
    (expected, i) => items![i] !== undefined && sameItem(items![i]!, expected),
  ).length;
  const detail = { given: items, placed: inPlace };
  if (items.length === n && inPlace === n)
    return result("ORDERED_SEQUENCE", "CORRECT", 1, [], detail);
  return result("ORDERED_SEQUENCE", "INCORRECT", inPlace / n, ["SEQUENCE_PARTIAL"], detail);
}

function markMatching(
  spec: Extract<MarkingSpec, { method: "MATCHING_PAIRS" }>,
  answer: LearnerAnswer,
): MarkResult {
  if (typeof answer !== "object" || answer === null || Array.isArray(answer))
    return invalid("MATCHING_PAIRS", "WRONG_SHAPE_OF_ANSWER");
  const given = answer as Record<string, LearnerAnswer>;
  const left = Object.keys(spec.pairs);
  const right = left.filter((key) => {
    const value = asString(given[key] ?? "");
    return value !== null && sameText(value, spec.pairs[key]!);
  });
  const answered = left.filter((key) => asString(given[key] ?? "")?.trim());
  if (answered.length === 0) return invalid("MATCHING_PAIRS", "EMPTY");
  const detail = { matched: right.length, of: left.length };
  if (right.length === left.length) return result("MATCHING_PAIRS", "CORRECT", 1, [], detail);
  return result(
    "MATCHING_PAIRS",
    "INCORRECT",
    right.length / left.length,
    ["PAIRS_PARTIAL"],
    detail,
  );
}

function markText(
  spec: Extract<MarkingSpec, { method: "TEXT_NORMALISED" }>,
  answer: LearnerAnswer,
): MarkResult {
  const text = asString(answer);
  if (text === null) return invalid("TEXT_NORMALISED", "WRONG_SHAPE_OF_ANSWER");
  if (normaliseText(text) === "") return invalid("TEXT_NORMALISED", "EMPTY");
  const key = textKey(text);
  const ok = spec.accepted.some((a) => sameText(a, text));
  return ok
    ? result("TEXT_NORMALISED", "CORRECT", 1, [], { normalised: key })
    : result("TEXT_NORMALISED", "INCORRECT", 0, [], { normalised: key });
}

// ── multi-part ──────────────────────────────────────────────────────────────────────────────────

function markMultiPart(
  spec: Extract<MarkingSpec, { method: "MULTI_PART" }>,
  answer: LearnerAnswer,
): MarkResult {
  if (typeof answer !== "object" || answer === null || Array.isArray(answer))
    return invalid("MULTI_PART", "WRONG_SHAPE_OF_ANSWER");
  const given = answer as Record<string, LearnerAnswer>;
  const parts: Record<string, MarkResult> = {};
  let earned = 0;
  let available = 0;
  for (const part of spec.parts) {
    available += part.marks;
    const partResult = markSpec(part.spec, given[part.id] ?? "");
    parts[part.id] = partResult;
    earned += part.marks * partResult.score;
  }
  const all = Object.values(parts);
  const status: MarkStatus = all.every((p) => p.status === "CORRECT")
    ? "CORRECT"
    : all.every((p) => p.status === "INVALID_INPUT")
      ? "INVALID_INPUT"
      : all.some((p) => p.status === "NEEDS_REVIEW")
        ? "NEEDS_REVIEW"
        : all.some((p) => p.status === "INCORRECT" || p.status === "INVALID_INPUT")
          ? "INCORRECT"
          : "ALMOST";
  const out = result("MULTI_PART", status, available === 0 ? 0 : earned / available, [], {
    parts: Object.fromEntries(
      Object.entries(parts).map(([id, p]) => [id, { status: p.status, score: p.score }]),
    ),
  });
  out.parts = parts;
  return out;
}

// ── entry points ────────────────────────────────────────────────────────────────────────────────

function markSpec(spec: MarkingSpec, answer: LearnerAnswer): MarkResult {
  switch (spec.method) {
    case "EXACT_NUMERIC":
      return markExactNumeric(spec, answer);
    case "EXPRESSION_EQUIVALENT":
      return markExpression(spec, answer);
    case "FRACTION_EQUIVALENT":
      return markFraction("FRACTION_EQUIVALENT", spec, answer);
    case "FRACTION_LOWEST_TERMS":
      return markFraction("FRACTION_LOWEST_TERMS", spec, answer);
    case "NUMERIC_WITH_UNIT":
      return markWithUnit(spec, answer);
    case "MULTIPLE_CHOICE":
      return markChoice(spec, answer);
    case "TRUE_FALSE":
      return markTrueFalse(spec, answer);
    case "ORDERED_SEQUENCE":
      return markSequence(spec, answer);
    case "MATCHING_PAIRS":
      return markMatching(spec, answer);
    case "TEXT_NORMALISED":
      return markText(spec, answer);
    case "MULTI_PART":
      return markMultiPart(spec, answer);
    case "MANUAL_REVIEW":
      return result("MANUAL_REVIEW", "NEEDS_REVIEW", 0);
  }
}

/**
 * Mark `answer` against the answer key `specInput` (as stored in question_keys.expected_answer).
 * Throws MarkingConfigError if the key itself is malformed — a bug in the question, surfaced loudly.
 */
export function mark(specInput: unknown, answer: LearnerAnswer): MarkResult {
  return markSpec(parseMarkingSpec(specInput), answer);
}

export type { UnitDef };

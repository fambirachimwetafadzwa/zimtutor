import { Rational } from "./rational";

/**
 * A small, SAFE arithmetic expression evaluator (no eval, no Function, no dependencies).
 *
 * It reads what a primary-school learner writes — "3,96 ÷ 3", "(2 + 3) × 4", "12 x 5", "2(3+4)",
 * "3/4 + 1/4", "10 − 2²" — and computes the exact value as a Rational. It is used to
 *   • check an expression against the expected one by VALUE (EXPRESSION_EQUIVALENT), and
 *   • diagnose order-of-operations mistakes (leftToRight).
 *
 * Only numbers, + − × ÷ * / ^ x X, brackets and a trailing % are understood; anything else is a
 * syntax error. Input length, nesting depth and exponent size are bounded.
 */

export type ExpressionError = "EMPTY" | "SYNTAX" | "DIVISION_BY_ZERO" | "TOO_COMPLEX";
export type ExpressionParse =
  { ok: true; value: Rational; node: Node } | { ok: false; error: ExpressionError };

type Node =
  | { kind: "num"; value: Rational }
  | { kind: "neg"; operand: Node }
  | { kind: "bin"; op: "+" | "-" | "*" | "/" | "^"; left: Node; right: Node };

const MAX_LENGTH = 160;
const MAX_DEPTH = 24;
const MAX_EXPONENT = 12;

type Token =
  | { t: "num"; value: Rational }
  | { t: "op"; value: "+" | "-" | "*" | "/" | "^" }
  | { t: "lp" }
  | { t: "rp" }
  | { t: "pct" };

const SUPERSCRIPTS: Record<string, string> = {
  "⁰": "0",
  "¹": "1",
  "²": "2",
  "³": "3",
  "⁴": "4",
  "⁵": "5",
  "⁶": "6",
  "⁷": "7",
  "⁸": "8",
  "⁹": "9",
};

class ExpressionFailure extends Error {
  constructor(readonly code: ExpressionError) {
    super(code);
  }
}

function tokenize(source: string): Token[] {
  // Superscript digits first: NFKC would flatten "2²" to "22".
  const powered = source.replace(
    /([⁰¹²³⁴⁵⁶⁷⁸⁹]+)/g,
    (run) => `^${[...run].map((c) => SUPERSCRIPTS[c]).join("")}`,
  );
  const text = powered
    .normalize("NFKC")
    .replace(/[\u00a0\u2009\u202f]/g, " ")
    .replace(/[−–—]/g, "-")
    .replace(/[×·∗]/g, "*")
    .replace(/[÷:]/g, "/")
    .replace(/[⁄∕]/g, "/")
    .replace(/[[{]/g, "(")
    .replace(/[\]}]/g, ")")
    .replace(/=\s*\??$/, "") // "3 + 4 =" → "3 + 4"
    .trim();
  const tokens: Token[] = [];
  let i = 0;
  const s = text;
  while (i < s.length) {
    const ch = s[i]!;
    if (ch === " ") {
      i++;
      continue;
    }
    if (/\d/.test(ch) || ((ch === "." || ch === ",") && /\d/.test(s[i + 1] ?? ""))) {
      // A number: digits, optionally grouped by single spaces into threes, optional . or , decimal part.
      let j = i;
      let digits = "";
      while (j < s.length) {
        const c = s[j]!;
        if (/\d/.test(c)) {
          digits += c;
          j++;
        } else if (
          c === " " &&
          /^\d{3}(?!\d)/.test(s.slice(j + 1)) &&
          /\d$/.test(digits) &&
          digits.replace(/\D/g, "").length <= 3 + 3 * 5 &&
          !/[.,]/.test(digits)
        ) {
          j++; // thousands space: "1 000"
        } else break;
      }
      if ((s[j] === "." || s[j] === ",") && /\d/.test(s[j + 1] ?? "")) {
        digits += ".";
        j++;
        while (j < s.length && /\d/.test(s[j]!)) digits += s[j++];
      } else if (digits === "" && (s[i] === "." || s[i] === ",")) {
        // handled above by the leading-separator guard
      }
      const value = Rational.parseDecimal(digits.startsWith(".") ? `0${digits}` : digits);
      if (!value || digits.replace(/[^\d]/g, "").length > 30) throw new ExpressionFailure("SYNTAX");
      tokens.push({ t: "num", value });
      i = j;
      continue;
    }
    if (ch === "+" || ch === "-" || ch === "*" || ch === "/" || ch === "^") {
      tokens.push({ t: "op", value: ch });
    } else if (ch === "x" || ch === "X") {
      tokens.push({ t: "op", value: "*" });
    } else if (ch === "(") tokens.push({ t: "lp" });
    else if (ch === ")") tokens.push({ t: "rp" });
    else if (ch === "%") tokens.push({ t: "pct" });
    else throw new ExpressionFailure("SYNTAX");
    i++;
  }
  return tokens;
}

class Parser {
  private pos = 0;
  private depth = 0;
  /**
   * "standard" follows operator precedence. "left-to-right" gives + − × ÷ one level so a chain is
   * evaluated strictly in reading order — what a learner who ignores precedence computes.
   */
  constructor(
    private readonly tokens: Token[],
    private readonly mode: "standard" | "left-to-right" = "standard",
  ) {}

  parse(): Node {
    const node = this.additive();
    if (this.pos !== this.tokens.length) throw new ExpressionFailure("SYNTAX");
    return node;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private additive(): Node {
    if (this.mode === "left-to-right") return this.readingOrder();
    let left = this.multiplicative();
    for (;;) {
      const t = this.peek();
      if (t?.t === "op" && (t.value === "+" || t.value === "-")) {
        this.pos++;
        left = { kind: "bin", op: t.value, left, right: this.multiplicative() };
      } else return left;
    }
  }

  private readingOrder(): Node {
    let left = this.unary();
    for (;;) {
      const t = this.peek();
      if (
        t?.t === "op" &&
        (t.value === "+" || t.value === "-" || t.value === "*" || t.value === "/")
      ) {
        this.pos++;
        left = { kind: "bin", op: t.value, left, right: this.unary() };
      } else if (t && (t.t === "lp" || t.t === "num")) {
        left = { kind: "bin", op: "*", left, right: this.unary() };
      } else return left;
    }
  }

  private multiplicative(): Node {
    let left = this.unary();
    for (;;) {
      const t = this.peek();
      if (t?.t === "op" && (t.value === "*" || t.value === "/")) {
        this.pos++;
        left = { kind: "bin", op: t.value, left, right: this.unary() };
      } else if (t && (t.t === "lp" || t.t === "num")) {
        // implicit multiplication: 2(3+4), (1+2)(3+4), (1+2)3
        left = { kind: "bin", op: "*", left, right: this.unary() };
      } else return left;
    }
  }

  private unary(): Node {
    const t = this.peek();
    if (t?.t === "op" && (t.value === "-" || t.value === "+")) {
      this.pos++;
      const operand = this.unary();
      return t.value === "-" ? { kind: "neg", operand } : operand;
    }
    return this.power();
  }

  private power(): Node {
    const base = this.postfix();
    const t = this.peek();
    if (t?.t === "op" && t.value === "^") {
      this.pos++;
      return { kind: "bin", op: "^", left: base, right: this.unary() }; // right-associative
    }
    return base;
  }

  private postfix(): Node {
    let node = this.primary();
    while (this.peek()?.t === "pct") {
      this.pos++;
      node = { kind: "bin", op: "/", left: node, right: { kind: "num", value: Rational.of(100) } };
    }
    return node;
  }

  private primary(): Node {
    const t = this.peek();
    if (!t) throw new ExpressionFailure("SYNTAX");
    if (t.t === "num") {
      this.pos++;
      return { kind: "num", value: t.value };
    }
    if (t.t === "lp") {
      if (++this.depth > MAX_DEPTH) throw new ExpressionFailure("TOO_COMPLEX");
      this.pos++;
      const inner = this.additive();
      if (this.peek()?.t !== "rp") throw new ExpressionFailure("SYNTAX");
      this.pos++;
      this.depth--;
      return inner;
    }
    throw new ExpressionFailure("SYNTAX");
  }
}

function evaluate(node: Node): Rational {
  switch (node.kind) {
    case "num":
      return node.value;
    case "neg":
      return evaluate(node.operand).neg();
    case "bin": {
      const l = evaluate(node.left);
      const r = evaluate(node.right);
      switch (node.op) {
        case "+":
          return l.add(r);
        case "-":
          return l.sub(r);
        case "*":
          return l.mul(r);
        case "/":
          if (r.isZero()) throw new ExpressionFailure("DIVISION_BY_ZERO");
          return l.div(r);
        case "^": {
          if (!r.isInteger() || r.num > BigInt(MAX_EXPONENT) || r.num < BigInt(-MAX_EXPONENT))
            throw new ExpressionFailure("TOO_COMPLEX");
          if (l.isZero() && r.isNegative()) throw new ExpressionFailure("DIVISION_BY_ZERO");
          return l.pow(Number(r.num));
        }
      }
    }
  }
}

function fail(error: unknown): { ok: false; error: ExpressionError } {
  if (error instanceof ExpressionFailure) return { ok: false, error: error.code };
  if (error instanceof RangeError) return { ok: false, error: "TOO_COMPLEX" };
  throw error;
}

export function evaluateExpression(source: string): ExpressionParse {
  if (source.length > MAX_LENGTH) return { ok: false, error: "TOO_COMPLEX" };
  if (source.trim() === "") return { ok: false, error: "EMPTY" };
  try {
    const node = new Parser(tokenize(source)).parse();
    return { ok: true, value: evaluate(node), node };
  } catch (error) {
    return fail(error);
  }
}

/** Equal by exact value. */
export function sameValue(a: string, b: string): boolean {
  const x = evaluateExpression(a);
  const y = evaluateExpression(b);
  return x.ok && y.ok && x.value.equals(y.value);
}

/**
 * The value a learner gets by working strictly left to right, ignoring operator precedence
 * ("2 + 3 × 4" → 20). Matching this instead of the true value is the classic order-of-operations
 * error. Brackets are respected. Null when it equals the true value (no precedence conflict) or the
 * expression cannot be read.
 */
export function leftToRightValue(source: string): Rational | null {
  const standard = evaluateExpression(source);
  if (!standard.ok) return null;
  try {
    const flat = evaluate(new Parser(tokenize(source), "left-to-right").parse());
    return flat.equals(standard.value) ? null : flat;
  } catch {
    return null;
  }
}

/**
 * Is `source` a sum of terms whose values are exactly `expectedTerms` (in any order)? Used to mark
 * EXPANDED NOTATION ("4 305 = 4000 + 300 + 5" or "4×1000 + 3×100 + 5"), where a bare equal value
 * ("4300 + 5") must NOT count.
 */
export function isSumOfTerms(source: string, expectedTerms: Array<number | bigint>): boolean {
  const parsed = evaluateExpression(source);
  if (!parsed.ok) return false;
  const terms: Rational[] = [];
  const collect = (n: Node, sign: 1 | -1) => {
    if (n.kind === "bin" && n.op === "+") {
      collect(n.left, sign);
      collect(n.right, sign);
    } else if (n.kind === "bin" && n.op === "-") {
      collect(n.left, sign);
      collect(n.right, sign === 1 ? -1 : 1);
    } else {
      const v = evaluate(n);
      terms.push(sign === 1 ? v : v.neg());
    }
  };
  try {
    collect(parsed.node, 1);
  } catch {
    return false;
  }
  if (terms.length !== expectedTerms.length) return false;
  const remaining = expectedTerms.map((t) => Rational.of(t));
  for (const term of terms) {
    const index = remaining.findIndex((r) => r.equals(term));
    if (index < 0) return false;
    remaining.splice(index, 1);
  }
  return true;
}

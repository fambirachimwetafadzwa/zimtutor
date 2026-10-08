import type { LearnerAnswer, MarkingSpec } from "../marking/spec";
import { numberToWords } from "../marking/words";
import { answerFormsFrom, findLeak } from "../questions/verify";
import {
  detectContactAttempts,
  detectHumanClaims,
  detectManipulation,
  detectOverclaims,
  detectPersonalDetails,
  detectPersonalQuestions,
} from "./patterns";

/**
 * Checks on everything a language model writes before a child sees it.
 *
 * The model is only ever asked to PHRASE what the application already decided (src/lib/tutor): the
 * draft it rewrites, the facts it may use and the verdict on the child's answer all come from
 * deterministic code. These guards make sure it stayed inside that:
 *
 *   – it did not give away the answer to a question that is still open (in digits, in words, as an
 *     option letter or as "true"/"false");
 *   – it did not introduce a number the application did not supply, or put a wrong number into an
 *     equation (it must not "calculate");
 *   – it did not contradict the verdict ("well done" after a wrong answer, "wrong" after a right one);
 *   – it contains no links, e-mail addresses, phone numbers or invitations to contact anyone, asks
 *     for no personal detail, claims to be neither a person nor the exam board, and uses no secrecy,
 *     guilt or pressure to stay;
 *   – it is plain text of a child-sized length and was not cut off.
 *
 * A reply that fails ANY check is thrown away and the application's own plain text is used instead
 * (see src/lib/tutor/voice.ts). The guards never repair a reply: a half-trusted sentence is not shown.
 */

export type GuardFailure =
  | "EMPTY"
  | "TOO_LONG"
  | "CUT_OFF"
  | "LEAKS_ANSWER"
  | "UNSUPPORTED_NUMBER"
  | "CONTRADICTS_VERDICT"
  | "LINK_OR_CONTACT"
  | "ASKS_FOR_PERSONAL_DETAIL"
  | "CLAIMS_TO_BE_HUMAN"
  | "MANIPULATIVE"
  | "OFFICIAL_CLAIM"
  | "MARKUP";

export type Verdict = "CORRECT" | "INCORRECT" | "ALMOST";

// ── the answer a reply must not give away ───────────────────────────────────────────────────────

export interface SecretAnswer {
  /** Whole-word strings that give the answer away wherever they appear. */
  forms: string[];
  /** One-character answers ("7", "B"): only given away next to words like "answer", "is" or "=". */
  short: string[];
  /** For a true/false question: any statement that it is true or false gives the answer away. */
  truthValue?: boolean;
  /** For an ordering question: stating every item in this order gives the answer away. */
  sequence?: string[];
  /** For a matching question: saying that two of these go together gives that pair away. */
  pairs?: Array<[string, string]>;
}

const WORD_ANSWER_LIMIT = 20; // "five" is an ordinary word; "forty-two" is not

function integerValue(text: string): number | null {
  const compact = text.replace(/[\s,]/g, "");
  if (!/^\d{1,6}$/.test(compact)) return null;
  return Number(compact);
}

/** What the stored key and the learner's view say the answer is. */
export function secretFromKey(
  key: { spec: MarkingSpec; display: LearnerAnswer },
  options?: ReadonlyArray<{ id: string; text: string }>,
): SecretAnswer {
  const forms = new Set(
    answerFormsFrom({
      marking: key.spec,
      correctAnswer: key.display,
      ...(options ? { options: options.map((o) => ({ id: o.id, text: o.text })) } : {}),
    }),
  );
  const short = new Set<string>();
  const addShort = (text: string) => {
    const t = text.trim();
    if (t.length === 1) short.add(t);
  };
  const addNumberWords = (text: string) => {
    const n = integerValue(text);
    if (n === null) return;
    const withAnd = numberToWords(n);
    const spellings = new Set<string>();
    for (const w of [withAnd, withAnd.replace(/ and /g, " ")]) {
      spellings.add(w);
      spellings.add(w.replace(/-/g, " ")); // "forty-two" and "forty two"
    }
    for (const w of spellings) {
      if (n <= WORD_ANSWER_LIMIT) short.add(w);
      else forms.add(w);
    }
  };

  const answer = key.display;
  if (key.spec.method === "MULTIPLE_CHOICE") {
    for (const id of key.spec.correct) {
      addShort(id);
      const option = options?.find((o) => o.id === id);
      if (option) {
        addShort(option.text);
        addNumberWords(option.text);
      }
    }
  } else if (typeof answer === "string") {
    addShort(answer);
    addNumberWords(answer);
    const leading = /^(-?[\d\s.,/]+)/.exec(answer);
    if (leading) {
      addShort(leading[1]!);
      addNumberWords(leading[1]!);
    }
  } else if (Array.isArray(answer)) {
    // a sequence: each item alone is not the answer, the order is
  } else if (typeof answer === "object" && answer !== null) {
    for (const value of Object.values(answer))
      if (typeof value === "string") {
        addShort(value);
        addNumberWords(value);
      }
  }

  return {
    forms: [...forms],
    short: [...short],
    ...(key.spec.method === "TRUE_FALSE" ? { truthValue: key.spec.value } : {}),
    ...(key.spec.method === "ORDERED_SEQUENCE" ? { sequence: [...key.spec.sequence] } : {}),
    ...(key.spec.method === "MATCHING_PAIRS"
      ? { pairs: Object.entries(key.spec.pairs) as Array<[string, string]> }
      : {}),
  };
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** "the answer is 7", "= 7", "makes seven", "option B" — a short answer given away by its context. */
function shortLeak(text: string, short: readonly string[]): string | null {
  for (const form of short) {
    const f = escapeRegExp(form);
    const symbolic = new RegExp(`(?:=|≈)\\s*(${f})(?![\\w])(?![.,]\\d)`, "gi");
    const spoken = new RegExp(
      `\\b(?:answer|result|total|sum|difference|product|quotient|remainder|equals?|makes?|gives?|is|are|get|got|be|choose|pick|select|option|letter)\\s+(?:(?:the|an?|option|choice|letter|number|correct)\\s+)*\\(?(${f})\\)?(?![\\w])(?![.,]\\d)(?!\\s*[×x*÷/+−-]\\s*\\d)`,
      "gi",
    );
    // A single capital letter is an option id: the article "a" in "is a straight line" is not it.
    const exactCase = /^[A-Za-z]$/.test(form);
    for (const pattern of [symbolic, spoken])
      for (const m of text.matchAll(pattern)) if (!exactCase || m[1] === form) return form;
  }
  return null;
}

/**
 * "it is true", "the answer is false", "choose true" — but not "decide whether it is true or false",
 * which is just the question being asked.
 */
const TRUTH_CLAIM =
  /\b(?:(?:it|that|this|the\s+statement|the\s+sentence)\s*(?:'s|is|was)|(?:the\s+)?answer\s*(?:is|:)?|choose|pick|select|say|is)\s+(?:definitely\s+|actually\s+|really\s+|indeed\s+)?(?:not\s+)?(?:true|false)\b(?!\s+or\b)/i;

/** An item as it may be written in a reply: "6 144" may also appear as "6144" or "6,144". */
function itemPattern(item: string): string {
  return escapeRegExp(item.trim()).replace(/\s+/g, "[\\s,]?");
}

/** Every item of an ordering answer, mentioned in the answer's order (other words may come between). */
function sequenceLeak(text: string, sequence: readonly string[]): boolean {
  let from = 0;
  for (const item of sequence) {
    const pattern = new RegExp(`(?<![\\w.,/])${itemPattern(item)}(?![\\w]|[.,]\\d|/\\d)`, "ig");
    pattern.lastIndex = from;
    const found = pattern.exec(text);
    if (!found) return false;
    from = found.index + found[0].length;
  }
  return true;
}

const PAIR_LINK =
  "(?:\\s*(?:=|\u2192|->|:|-|\u2013)\\s*|\\s+(?:is|are|matches|match|goes\\s+with|go\\s+with|pairs\\s+with|with|to)\\s+)";

/** A statement that two things go together, for a pair that does. */
function pairLeak(text: string, pairs: ReadonlyArray<readonly [string, string]>): string | null {
  for (const [left, right] of pairs) {
    const l = itemPattern(left);
    const r = itemPattern(right);
    const pattern = new RegExp(
      `(?<![\\w])${l}${PAIR_LINK}${r}(?![\\w])|(?<![\\w])${r}${PAIR_LINK}${l}(?![\\w])`,
      "i",
    );
    if (pattern.test(text)) return `${left} - ${right}`;
  }
  return null;
}

export function leakedAnswer(text: string, secret: SecretAnswer): string | null {
  const form = findLeak(text, secret.forms);
  if (form !== null) return form;
  const short = shortLeak(text, secret.short);
  if (short !== null) return short;
  if (secret.truthValue !== undefined && TRUTH_CLAIM.test(text)) return String(secret.truthValue);
  if (secret.sequence && sequenceLeak(text, secret.sequence)) return secret.sequence.join(", ");
  if (secret.pairs) {
    const pair = pairLeak(text, secret.pairs);
    if (pair !== null) return pair;
  }
  return null;
}

// ── numbers ─────────────────────────────────────────────────────────────────────────────────────

// Digit groups may be separated by a space, a non-breaking space (code 0xa0), a narrow one (0x202f) or a comma.
const GROUP_SPACES = [" ", String.fromCharCode(0xa0), String.fromCharCode(0x202f)].join("");
const NUMBER = new RegExp(`(?<![\\w.])\\d+(?:[${GROUP_SPACES},]\\d{3})*(?:\\.\\d+)?(?!\\d)`, "g");
const GROUP_SEPARATORS = new RegExp(`[${GROUP_SPACES},]`, "g");

function canonicalNumber(token: string): string {
  const compact = token.replace(GROUP_SEPARATORS, "");
  const [whole = "0", fraction] = compact.split(".");
  const integer = whole.replace(/^0+(?=\d)/, "");
  const trimmed = fraction?.replace(/0+$/, "");
  return trimmed ? `${integer}.${trimmed}` : integer;
}

interface NumberToken {
  value: string;
  index: number;
  length: number;
}

function numberTokens(text: string): NumberToken[] {
  return [...text.matchAll(NUMBER)].map((m) => ({
    value: canonicalNumber(m[0]),
    index: m.index ?? 0,
    length: m[0].length,
  }));
}

/** Every number the given texts mention (a number printed "4 305" counts as 4305, and as 4 and 305). */
export function numbersIn(texts: readonly string[]): Set<string> {
  const found = new Set<string>();
  for (const text of texts) {
    for (const t of numberTokens(text)) found.add(t.value);
    // also the parts of a spaced number, in case it was really two numbers ("12 345" = 12 and 345)
    for (const m of text.matchAll(/\d+(?:\.\d+)?/g)) found.add(canonicalNumber(m[0]));
  }
  return found;
}

const OPERATORS = "+−×÷*/=<>^";

function inMathContext(text: string, token: NumberToken): boolean {
  const before = text.slice(0, token.index).trimEnd();
  const after = text.slice(token.index + token.length).trimStart();
  const prev = before.at(-1) ?? "";
  const next = after[0] ?? "";
  if (OPERATORS.includes(prev) || OPERATORS.includes(next)) return true;
  // "3 x 4" and "7-3": the letter x or a hyphen only count between numbers
  const nextAfter = after.slice(1).trimStart();
  if ((next === "x" || next === "X" || next === "-" || next === "–") && /^\d/.test(nextAfter))
    return true;
  const prevBefore = before.slice(0, -1).trimEnd();
  if ((prev === "x" || prev === "X" || prev === "-" || prev === "–") && /\d$/.test(prevBefore))
    return true;
  return false;
}

/**
 * Numbers in `text` that the application did not supply. A single digit in ordinary talk ("step 2",
 * "1 more hint") is fine; any other number, and any digit inside a sum, must come from `allowed`.
 */
export function unsupportedNumbers(text: string, allowed: ReadonlySet<string>): string[] {
  const bad: string[] = [];
  for (const token of numberTokens(text)) {
    if (allowed.has(token.value)) continue;
    const single = /^\d$/.test(token.value);
    if (single && !inMathContext(text, token)) continue;
    bad.push(token.value);
  }
  return bad;
}

// ── tone and content ────────────────────────────────────────────────────────────────────────────

const PRAISE =
  /\b(?:well\s+done|good\s+job|great\s+job|great\s+work|excellent|perfect|spot\s+on|you\s+got\s+it|you(?:'ve|\s+have)\s+got\s+it|exactly\s+right|brilliant|fantastic|bravo|that(?:'s|\s+is)\s+(?:absolutely\s+|completely\s+|totally\s+)?(?:right|correct)|your\s+answer\s+is\s+(?:absolutely\s+|completely\s+)?(?:right|correct)|you(?:'re|\s+are)\s+(?:absolutely\s+|completely\s+)?(?:right|correct))\b/i;
const WRONGNESS =
  /\b(?:incorrect|wrong|not\s+(?:quite\s+)?(?:right|correct)|mistake|oops|try\s+again)\b/i;

export function contradictsVerdict(text: string, verdict: Verdict): boolean {
  if (verdict === "CORRECT") return WRONGNESS.test(text);
  if (verdict === "INCORRECT") return PRAISE.test(text);
  return PRAISE.test(text) || /\bwrong\b/i.test(text); // ALMOST
}

/** Markdown and other markup the plain-text screens would show as stray symbols. */
export function plainText(input: string): string {
  return input
    .replace(/```[a-z]*\n?/gi, "")
    .replace(/`([^`\n]*)`/g, "$1")
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/__([^_\n]+)__/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const MARKUP =
  /<\/?[a-z!][^>]*>|\\(?:frac|times|div|cdot|sqrt|text|left|right|begin|end)\b|\\[(\[]/i;

export function wordCount(text: string): number {
  const words = text.trim().split(/\s+/);
  return words.length === 1 && words[0] === "" ? 0 : words.length;
}

// ── the guard ───────────────────────────────────────────────────────────────────────────────────

export interface GuardInput {
  text: string;
  maxWords: number;
  /** The reply stopped because it ran out of room. */
  truncated?: boolean;
  /** The answer to a question that is still open. Leave out once the answer has been revealed on purpose. */
  secret?: SecretAnswer;
  /** The text the reply's numbers may come from: the draft, the facts, the question, the child's answer. */
  sources: readonly string[];
  verdict?: Verdict;
}

export interface GuardResult {
  ok: boolean;
  /** The reply as plain text (markdown removed). Use it only when `ok`. */
  text: string;
  failures: GuardFailure[];
  /** Short reasons for the log: never shown to a child. */
  details: string[];
}

export function checkTutorText(input: GuardInput): GuardResult {
  const text = plainText(input.text);
  const failures = new Set<GuardFailure>();
  const details: string[] = [];
  const fail = (failure: GuardFailure, detail: string) => {
    failures.add(failure);
    details.push(detail);
  };

  if (text.length === 0) fail("EMPTY", "no text");
  if (input.truncated) fail("CUT_OFF", "stopped at the token limit");
  const words = wordCount(text);
  if (words > input.maxWords) fail("TOO_LONG", `${words} words, limit ${input.maxWords}`);

  if (MARKUP.test(text)) fail("MARKUP", "markup or LaTeX in the reply");

  if (input.secret) {
    const leak = leakedAnswer(text, input.secret);
    if (leak !== null) fail("LEAKS_ANSWER", `gives away "${leak}"`);
  }

  const unsupported = unsupportedNumbers(text, numbersIn(input.sources));
  if (unsupported.length > 0) fail("UNSUPPORTED_NUMBER", `new numbers: ${unsupported.join(", ")}`);

  if (input.verdict && contradictsVerdict(text, input.verdict))
    fail("CONTRADICTS_VERDICT", `reads wrongly after a ${input.verdict} answer`);

  const contact = [...detectPersonalDetails(text), ...detectContactAttempts(text)];
  if (contact.length > 0)
    fail("LINK_OR_CONTACT", `contains ${contact[0]!.kind}: ${contact[0]!.match}`);

  const asks = detectPersonalQuestions(text);
  if (asks.length > 0) fail("ASKS_FOR_PERSONAL_DETAIL", asks[0]!.kind);

  const human = detectHumanClaims(text);
  if (human.length > 0) fail("CLAIMS_TO_BE_HUMAN", human[0]!.match);

  const pressure = detectManipulation(text);
  if (pressure.length > 0) fail("MANIPULATIVE", `${pressure[0]!.kind}: ${pressure[0]!.match}`);

  const claims = detectOverclaims(text);
  if (claims.length > 0) fail("OFFICIAL_CLAIM", claims[0]!.match);

  return { ok: failures.size === 0, text, failures: [...failures], details };
}

/**
 * Nothing leaves the server for a monitoring service without passing through here. A child's words,
 * a parent's email address, a phone number, an internet address, a token: none of it may reach a
 * third party, not even by accident inside an error message.
 *
 * This is the second line of defence. The first is that such things are never put into messages, and
 * that what is reported is chosen from a short list (see `allowedFields` and the event catalogue in
 * events.ts) rather than whatever happens to be to hand.
 */

const MESSAGE_LIMIT = 300;
const FIELD_LIMIT = 80;
const STACK_FRAMES = 30;

type Replacement = string | ((match: string) => string);

/** Replacements, in the order they are applied: the more specific shapes go first. */
const REPLACEMENTS: ReadonlyArray<readonly [RegExp, Replacement]> = [
  // credentials and keys
  [/\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]*/g, "[token]"],
  [/\b(?:Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "[token]"],
  [/\b(?:sk|pk|rk|sb)[-_][A-Za-z0-9_-]{12,}/g, "[key]"],
  // an address a message is for: the learner sign-in addresses are made up, but are still a username
  [/[A-Z0-9._%+'-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]"],
  // a web address keeps its host and path but loses what comes after "?" or "#", and any login in it
  [/\b(https?:\/\/)(?:[^\s/@"'<>]*@)?([^\s/?#"'<>]+)([^\s?#"'<>]*)(?:[?#][^\s"'<>]*)?/gi, "$1$2$3"],
  // what the database says about a row: Key (username)=(chipo) already exists
  [/\bKey \([^)]*\)=\([^)]*\)/g, "Key ([field])=([value])"],
  // identifiers
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "[id]"],
  // internet addresses
  [/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[address]"],
  [/\b(?:[0-9a-f]{1,4}:){2,7}[0-9a-f]{0,4}\b/gi, "[address]"],
  // telephone numbers, written any way: a run of at least seven digits, however it is spaced
  [/\+?\d(?:[\s().-]{0,2}\d){6,}/g, "[number]"],
  // quoted text with spaces in it is somebody's sentence, not an identifier
  [
    /"[^"\n]{12,}"|'[^'\n]{12,}'|`[^`\n]{12,}`/g,
    (match) => (/\s/.test(match) ? '"[text]"' : match),
  ],
];

/** A message with the personal and secret parts taken out, and cut short. */
export function scrubText(text: string, limit = MESSAGE_LIMIT): string {
  let out = String(text);
  for (const [pattern, replacement] of REPLACEMENTS) {
    out =
      typeof replacement === "string"
        ? out.replace(pattern, replacement)
        : out.replace(pattern, replacement);
  }
  out = out.replace(/\s+/g, " ").trim();
  return out.length > limit ? `${out.slice(0, limit - 1)}…` : out;
}

/** Stack frames only ("at where (file:line:column)"): no message, no values, no more than 30. */
export function scrubStack(stack: string | undefined): string[] {
  if (!stack) return [];
  return (
    stack
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("at "))
      .slice(0, STACK_FRAMES)
      // a frame names code, never data; but a path can have a login in a URL
      .map((line) => scrubText(line, 200))
  );
}

export interface DescribedError {
  name: string;
  message: string;
  frames: string[];
  /** A database or HTTP code, when the error has a short one. */
  code?: string;
}

/** Say what an error is without anything it may have been carrying. */
export function describeError(error: unknown): DescribedError {
  if (error instanceof Error) {
    const raw = (error as { code?: unknown }).code;
    const code =
      typeof raw === "string" && /^[A-Za-z0-9_.:-]{1,40}$/.test(raw)
        ? raw
        : typeof raw === "number"
          ? String(raw)
          : undefined;
    return {
      name: /^[A-Za-z][A-Za-z0-9_]{0,60}$/.test(error.name) ? error.name : "Error",
      message: scrubText(error.message),
      frames: scrubStack(error.stack),
      ...(code ? { code } : {}),
    };
  }
  // something that was thrown but is not an error: say what kind of thing, not what it holds
  return { name: "NonError", message: `a ${typeof error} was thrown`, frames: [] };
}

/** The extra facts that may accompany a report. Anything else is dropped. */
export const ALLOWED_FIELDS: ReadonlySet<string> = new Set([
  "action",
  "answered",
  "bucket",
  "code",
  "count",
  "digest",
  "firstTry",
  "grade",
  "kind",
  "length",
  "mode",
  "ms",
  "objective",
  "of",
  "outcome",
  "paper",
  "provider",
  "reason",
  "resolved",
  "route",
  "routeType",
  "status",
  "step",
]);

export type SafeFields = Record<string, string | number | boolean>;

/**
 * Keep the facts that are on the list and are plain: a number, a yes or no, or a short identifier
 * (letters, digits and _ . : / - [ ], no spaces). Any other string is not kept, since it might be
 * anyone's words.
 */
export function safeFields(fields: Record<string, unknown> | undefined): SafeFields {
  const out: SafeFields = {};
  for (const [key, value] of Object.entries(fields ?? {})) {
    if (!ALLOWED_FIELDS.has(key)) continue;
    if (typeof value === "boolean") out[key] = value;
    else if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
    else if (typeof value === "string" && value.length <= FIELD_LIMIT) {
      const clean = scrubText(value, FIELD_LIMIT);
      // an identifier or a route (no spaces, so no sentences) that scrubbing left as it was
      if (/^[A-Za-z0-9_.:/[\]-]+$/.test(clean) && clean === value) out[key] = clean;
    }
  }
  return out;
}

/** A route as the framework names it ("/student/learn/[objectiveId]"), never the address that was asked for. */
export function routeOnly(path: string | undefined): string | undefined {
  if (!path) return undefined;
  const bare = path.split(/[?#]/)[0] ?? "";
  return scrubText(bare, FIELD_LIMIT);
}

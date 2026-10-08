import {
  detectContactAttempts,
  detectInstructionAttempts,
  detectLowMood,
  detectPersonalDetails,
  detectUnkindLanguage,
  detectWellbeingConcerns,
  redact,
  type Detection,
} from "./patterns";

/**
 * The screen every message a learner TYPES goes through before anything else happens to it.
 *
 * It is deterministic and runs in the application, not in a model, so a child's message is judged the
 * same way every time and the judgement can be read and tested:
 *
 *   – personal details (phone number, address, e-mail, links, passwords)  → never forwarded, kept in
 *     the record with the details removed, flagged for a person to review;
 *   – worrying messages (harm, abuse, fear, bullying, hunger)             → a warm fixed reply that
 *     points to trusted adults and a child helpline, flagged for a person to review;
 *   – attempts to move to other apps / to meet                            → a fixed reply;
 *   – attempts to change the tutor's rules; unkind words                  → a fixed reply;
 *   – feeling low                                                          → a warm fixed reply.
 *
 * Whatever passes is still treated as untrusted DATA when a model sees it (see prompts.ts): it can
 * never become an instruction.
 *
 * What this cannot do: understand every way a child might say something (other languages, spelling,
 * code words). It is a net, not a guarantee, and the deployment still needs a person who looks at the
 * flagged messages and a safeguarding procedure for what to do about them (see the README).
 */

export type SafetyCategory =
  | "EMPTY"
  | "TOO_LONG"
  | "WELLBEING"
  | "PERSONAL_INFO"
  | "OFF_PLATFORM"
  | "INSTRUCTION_ATTEMPT"
  | "UNKIND"
  | "LOW_MOOD";

export interface Helpline {
  name: string;
  number: string;
}

/**
 * Zimbabwe's national child helpline. Operators must confirm this before launch and may override it
 * (CHILD_HELPLINE); a wrong number in a message to a child in distress would be worse than none.
 */
export const DEFAULT_HELPLINE: Helpline = { name: "Childline", number: "116" };

/**
 * The helpline from configuration: CHILD_HELPLINE_NUMBER=none names none, a number replaces the default,
 * and CHILD_HELPLINE_NAME renames it.
 */
export function helplineFromSettings(settings: {
  name?: string | undefined;
  number?: string | undefined;
}): Helpline | null {
  const number = settings.number?.trim();
  if (number && number.toLowerCase() === "none") return null;
  if (!number) return { ...DEFAULT_HELPLINE, name: settings.name?.trim() || DEFAULT_HELPLINE.name };
  return { name: settings.name?.trim() || "the child helpline", number };
}

/** A chat message is a sentence or two; answers to questions do not pass through here. */
export const MAX_LEARNER_MESSAGE_CHARS = 500;

export interface ScreenOptions {
  /** The helpline named in a worrying-message reply; null names none. */
  helpline?: Helpline | null;
  maxChars?: number;
}

export interface ScreenResult {
  /** Nothing needs attention: the message may be answered as usual. */
  clean: boolean;
  /** Whether the text may be given to a language model (as untrusted learner data). */
  forward: boolean;
  /** Whether a person should be able to review the message (stored with `flagged = true`). */
  flag: boolean;
  categories: SafetyCategory[];
  /** The tidied message: what a model would see when `forward` is true. */
  text: string;
  /** What to keep in the conversation record: personal details replaced by "[removed]". */
  stored: string;
  /** A fixed reply for messages that are not answered in the usual way. */
  reply?: string;
}

// Built from code points: invisible characters must never be typed into the source.
const ZERO_WIDTH_CODES = [0x200b, 0x200c, 0x200d, 0x200e, 0x200f, 0x2028, 0x2029, 0x2060, 0xfeff];
const ZERO_WIDTH = new RegExp(
  `[${ZERO_WIDTH_CODES.map((code) => String.fromCharCode(code)).join("")}]`,
  "g",
);
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;

/** Unicode-normalised, without control or zero-width characters, whitespace collapsed. */
export function tidyMessage(input: string): string {
  return input
    .normalize("NFKC")
    .replace(ZERO_WIDTH, "")
    .replace(CONTROL, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Most important first: a message that fits two categories gets the first one's reply. */
const PRIORITY: readonly SafetyCategory[] = [
  "WELLBEING",
  "PERSONAL_INFO",
  "OFF_PLATFORM",
  "INSTRUCTION_ATTEMPT",
  "UNKIND",
  "LOW_MOOD",
  "TOO_LONG",
  "EMPTY",
];

const FLAGGED: ReadonlySet<SafetyCategory> = new Set<SafetyCategory>([
  "WELLBEING",
  "PERSONAL_INFO",
]);

export function replyFor(category: SafetyCategory, helpline: Helpline | null): string {
  switch (category) {
    case "WELLBEING":
      return [
        "I'm really sorry about this. What you said matters, and you do not have to deal with it alone.",
        "Please tell a grown-up you trust today: a parent or guardian, a relative, your teacher or the school counsellor.",
        helpline
          ? `You can also phone ${helpline.name} on ${helpline.number}. They listen to children.`
          : "",
        "I am a maths tutor on a computer, so I am not the right helper for this. When you feel ready, I will be here for maths.",
      ]
        .filter(Boolean)
        .join(" ");
    case "PERSONAL_INFO":
      return "Thank you for telling me, but please keep private things like phone numbers, addresses and passwords to yourself. I do not need them, and keeping them private keeps you safe. Let's carry on with your maths.";
    case "OFF_PLATFORM":
      return "I can only help with maths here in ZimTutor, so I cannot chat on other apps, call or meet. If you want to talk about something else, ask your teacher or a grown-up at home. Let's carry on with your maths.";
    case "INSTRUCTION_ATTEMPT":
      return "I am your ZimTutor maths tutor, so I stick to maths in this lesson. Let's carry on.";
    case "UNKIND":
      return "Let's keep our words kind, please. It helps us both. Shall we carry on with the maths?";
    case "LOW_MOOD":
      return "I'm sorry you feel like that. Maths can be hard sometimes, and it is okay to feel that way. If something is worrying you, tell a grown-up you trust. We can also stop for now and come back later.";
    case "TOO_LONG":
      return "That is a long message! Please say it again in a few words so I can understand it.";
    case "EMPTY":
      return "Type your message, then press send.";
  }
}

export function screenLearnerMessage(input: string, options: ScreenOptions = {}): ScreenResult {
  const helpline = options.helpline === undefined ? DEFAULT_HELPLINE : options.helpline;
  const maxChars = options.maxChars ?? MAX_LEARNER_MESSAGE_CHARS;
  const text = tidyMessage(input);

  const found = new Set<SafetyCategory>();
  const personal: Detection[] = [];

  if (text.length === 0) found.add("EMPTY");
  if (text.length > maxChars) found.add("TOO_LONG");

  // A message that is too long is refused anyway, so only its beginning is looked at (the patterns
  // should not have to run over something enormous), and only that beginning is ever kept.
  const scanned = text.slice(0, maxChars * 4);
  if (scanned.length > 0) {
    if (detectWellbeingConcerns(scanned).length > 0) found.add("WELLBEING");
    const details = detectPersonalDetails(scanned);
    if (details.length > 0) {
      found.add("PERSONAL_INFO");
      personal.push(...details);
    }
    if (detectContactAttempts(scanned).length > 0) found.add("OFF_PLATFORM");
    if (detectInstructionAttempts(scanned).length > 0) found.add("INSTRUCTION_ATTEMPT");
    if (detectUnkindLanguage(scanned).length > 0) found.add("UNKIND");
    if (detectLowMood(scanned).length > 0) found.add("LOW_MOOD");
  }

  const categories = PRIORITY.filter((c) => found.has(c));
  if (categories.length === 0) {
    return { clean: true, forward: true, flag: false, categories: [], text, stored: text };
  }
  const top = categories[0]!;
  return {
    clean: false,
    forward: false,
    flag: categories.some((c) => FLAGGED.has(c)),
    categories,
    text,
    // Personal details are never stored; a message that was too long is kept cut short.
    stored: redact(scanned, personal),
    reply: replyFor(top, helpline),
  };
}

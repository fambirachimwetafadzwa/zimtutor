/**
 * Deterministic detectors for text that must not pass between a child and the tutor.
 *
 * They serve two checks: the SAFETY SCREEN on what a learner types (src/lib/ai/safety.ts) and the
 * OUTPUT GUARDS on what a language model writes (src/lib/ai/guards.ts). They are plain regular
 * expressions on purpose: a safety rule must behave the same way every time, cost nothing to run and
 * be readable by a reviewer. They are a best-effort net, not a guarantee — the product also never
 * asks a child for personal details, never lets a model contact anyone, and keeps the model's reply
 * short and checked against the facts the application supplied.
 *
 * Maths must pass untouched: "4 305 000", "0.5 0.25", "3/4", "0 1 2 3 4 5" and "12 + 30" are not
 * phone numbers, and "I forget the rules for fractions" is not an attempt to change the tutor's rules.
 */

export interface Detection {
  /** What was found, for logs and tests. */
  kind: string;
  /** The exact text that matched (to be replaced when the message is stored). */
  match: string;
  index: number;
}

interface Rule {
  kind: string;
  pattern: RegExp;
}

function scan(text: string, rules: readonly Rule[]): Detection[] {
  const found: Detection[] = [];
  for (const rule of rules) {
    const pattern = new RegExp(
      rule.pattern.source,
      rule.pattern.flags.includes("g") ? rule.pattern.flags : `${rule.pattern.flags}g`,
    );
    for (const m of text.matchAll(pattern))
      found.push({ kind: rule.kind, match: m[0], index: m.index ?? 0 });
  }
  return found.sort((a, b) => a.index - b.index);
}

// ── personal details ────────────────────────────────────────────────────────────────────────────

const TLDS = "com|org|net|edu|gov|info|biz|io|tv|gg|app|xyz|link|zw|za|dev|site|online|shop";

const PERSONAL_RULES: readonly Rule[] = [
  { kind: "email", pattern: /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/i },
  { kind: "url", pattern: /\b(?:https?:\/\/|www\.)\S+/i },
  {
    kind: "url",
    pattern: new RegExp(`\\b(?:[a-z0-9-]+\\.)+(?:${TLDS})\\b(?:\\/\\S*)?`, "i"),
  },
  // @name — not the middle of an e-mail address
  { kind: "handle", pattern: /(?<![\w.@])@[a-z0-9_.]{3,}/i },
  // Zimbabwean national ID / birth-certificate style number: 63-123456 A 42
  { kind: "id-number", pattern: /\b\d{2}[- ]?\d{6,7}[- ]?[a-z][- ]?\d{2}\b/i },
  // "12 Samora Machel Avenue": a number, a capitalised name, a street word (so "a 5 km drive" is fine)
  {
    kind: "address",
    pattern:
      /\b\d{1,5}\s+(?:[A-Z][a-z']+\s+){1,3}(?:Street|St|Road|Rd|Avenue|Ave|Drive|Crescent|Close|Lane|Extension)\b/,
  },
  {
    kind: "address-statement",
    pattern: /\b(?:my|our)\s+(?:home\s+|house\s+|postal\s+)?address\b/i,
  },
  {
    kind: "location-statement",
    pattern:
      /\bi\s+(?:live|stay|am\s+staying)\s+(?:at|in|on|near|around|behind|opposite|next\s+to)\b/i,
  },
  { kind: "location-statement", pattern: /\bwhere\s+i\s+(?:live|stay)\b/i },
  { kind: "password", pattern: /\b(?:my|the)\s+(?:password|pin\s*(?:number|code)?)\b/i },
  { kind: "password", pattern: /\bpassword\s*(?:is|:|=)/i },
];

const DIGIT_WORDS = [
  "zero",
  "oh",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
];
const SPOKEN_NUMBER = new RegExp(
  `\\b(?:(?:${DIGIT_WORDS.join("|")})[\\s,.-]+){8,}(?:${DIGIT_WORDS.join("|")})\\b`,
  "i",
);
const SPOKEN_VALUE: Record<string, number> = {
  zero: 0,
  oh: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
};

/** A run of digits that is shaped like a telephone number (spaces, hyphens and brackets only: no dots). */
const PHONE_CANDIDATE = /(?<![\w.])\+?\d[\d\s\-()]{7,}\d(?!\w)/g;

/** 0123456789, 9876543210, 1234 5678 …: counting, not a number anyone owns. */
function isCountingRun(digits: string): boolean {
  if (digits.length < 4) return false;
  let up = true;
  let down = true;
  for (let i = 1; i < digits.length; i++) {
    const step = Number(digits[i]) - Number(digits[i - 1]);
    if (step !== 1 && !(step === -9 && digits[i - 1] === "9")) up = false;
    if (step !== -1 && !(step === 9 && digits[i - 1] === "0")) down = false;
  }
  return up || down;
}

function looksLikePhone(candidate: string): boolean {
  const digits = candidate.replace(/\D/g, "");
  if (isCountingRun(digits)) return false;
  if (candidate.trim().startsWith("+")) return digits.length >= 9 && digits.length <= 15;
  // Local numbers start with 0 (077 123 4567, 0242 123 456); a quantity never starts with 0.
  if (/^0\d{8,10}$/.test(digits)) return true;
  return /^263\d{8,10}$/.test(digits);
}

function phoneDetections(text: string): Detection[] {
  const found: Detection[] = [];
  for (const m of text.matchAll(PHONE_CANDIDATE)) {
    if (looksLikePhone(m[0])) found.push({ kind: "phone", match: m[0], index: m.index ?? 0 });
  }
  const spoken = SPOKEN_NUMBER.exec(text);
  if (spoken) {
    const digits = spoken[0]
      .toLowerCase()
      .split(/[\s,.-]+/)
      .map((w) => String(SPOKEN_VALUE[w] ?? ""))
      .join("");
    if (!isCountingRun(digits))
      found.push({ kind: "phone", match: spoken[0], index: spoken.index });
  }
  return found;
}

/** E-mail addresses, web links, social handles, phone numbers, ID numbers, addresses, passwords. */
export function detectPersonalDetails(text: string): Detection[] {
  return [...scan(text, PERSONAL_RULES), ...phoneDetections(text)].sort(
    (a, b) => a.index - b.index,
  );
}

// ── contact outside ZimTutor ────────────────────────────────────────────────────────────────────

const APPS =
  "whats\\s?app|facebook|instagram|snap\\s?chat|tik\\s?tok|telegram|discord|messenger|wechat|twitter|skype";

const CONTACT_RULES: readonly Rule[] = [
  { kind: "app", pattern: new RegExp(`\\b(?:${APPS})\\b`, "i") },
  {
    kind: "contact-request",
    pattern: /\b(?:dm|inbox|message|text|call|phone|ring|video\s?call|email|add|follow)\s+me\b/i,
  },
  {
    kind: "contact-request",
    pattern:
      /\b(?:give|send|share|tell)\s+me\s+(?:your|ur)\s+(?:phone|cell|mobile|number|email|address|contact)/i,
  },
  {
    kind: "contact-request",
    pattern: /\b(?:your|ur)\s+(?:phone|cell|mobile|whatsapp|contact)\s+(?:number|no\.?)\b/i,
  },
  {
    kind: "contact-request",
    pattern:
      /\b(?:send|share|show)\s+(?:me\s+)?(?:a\s+|your\s+|ur\s+)?(?:photo|picture|pic|selfie|video)s?\b/i,
  },
  { kind: "meeting", pattern: /\b(?:meet|see|visit)\s+(?:me|you|up)\b/i },
  { kind: "meeting", pattern: /\b(?:come|coming)\s+to\s+my\b/i },
  {
    kind: "meeting",
    pattern: /\b(?:talk|chat|speak)\s+(?:on|outside|elsewhere|somewhere|in\s+private|privately)\b/i,
  },
];

/** Apps, requests for contact details or photos, and invitations to meet. */
export function detectContactAttempts(text: string): Detection[] {
  return scan(text, CONTACT_RULES);
}

// ── questions a tutor must never ask ────────────────────────────────────────────────────────────

const PERSONAL_QUESTION_RULES: readonly Rule[] = [
  {
    kind: "asks-name",
    pattern:
      /\b(?:what(?:'s|\s+is)|tell\s+me|give\s+me|share|send)\s+(?:me\s+)?(?:your|ur)\s+(?:full\s+|first\s+|last\s+|sur)?name\b/i,
  },
  { kind: "asks-name", pattern: /\bwhat\s+(?:should|can|do)\s+i\s+call\s+you\b/i },
  {
    kind: "asks-location",
    pattern: /\bwhere\s+(?:do|did|are)\s+you\s+(?:live|stay|staying|from|now)\b/i,
  },
  {
    kind: "asks-location",
    pattern: /\b(?:your|ur)\s+(?:home\s+|house\s+)?(?:address|location|village|suburb|town)\b/i,
  },
  { kind: "asks-age", pattern: /\bhow\s+old\s+are\s+you\b/i },
  { kind: "asks-age", pattern: /\bwhen\s+(?:is|was)\s+your\s+birthday\b/i },
  { kind: "asks-school", pattern: /\b(?:which|what)\s+school\s+(?:do|did|are)\s+you\b/i },
  {
    kind: "asks-family",
    pattern:
      /\b(?:your|ur)\s+(?:mum|mom|mother|dad|father|parents?|guardian|teacher|brother|sister)(?:'s|s')?\s+(?:name|number|phone|job|work)\b/i,
  },
  { kind: "asks-password", pattern: /\b(?:your|ur)\s+(?:password|pin)\b/i },
  {
    kind: "asks-photo",
    pattern: /\b(?:send|show|share|take)\s+(?:me\s+)?(?:a\s+)?(?:photo|picture|pic|selfie)s?\b/i,
  },
];

export function detectPersonalQuestions(text: string): Detection[] {
  return scan(text, PERSONAL_QUESTION_RULES);
}

// ── things the tutor must never say ─────────────────────────────────────────────────────────────

const MANIPULATION_RULES: readonly Rule[] = [
  {
    kind: "secrecy",
    pattern: /\b(?:don'?t|do\s+not|never)\s+tell\s+(?:your\s+|anyone|anybody|any\s+one|a\s+grown)/i,
  },
  {
    kind: "secrecy",
    pattern: /\b(?:our\s+(?:little\s+)?secret|between\s+(?:us|you\s+and\s+me))\b/i,
  },
  { kind: "secrecy", pattern: /\bkeep\s+(?:this|it|that)\s+(?:a\s+)?(?:secret|private)\b/i },
  {
    kind: "clinging",
    pattern:
      /\b(?:please\s+)?(?:don'?t|do\s+not)\s+(?:leave|quit|go\s+(?:yet|now|away)|go(?=\s*(?:[.!?,]|$)))/i,
  },
  { kind: "clinging", pattern: /\b(?:don'?t|do\s+not)\s+stop\s+(?:now|yet)\b/i },
  {
    kind: "clinging",
    pattern:
      /\bi(?:'ll|\s+will|\s+would)\s+(?:really\s+)?(?:miss\s+you|be\s+(?:sad|lonely|upset))\b/i,
  },
  { kind: "clinging", pattern: /\bi\s+(?:love|need|miss)\s+you\b/i },
  {
    kind: "clinging",
    pattern:
      /\b(?:you\s+(?:must|have\s+to|need\s+to|should)\s+(?:come\s+back|return)|come\s+back\s+every\s+day|(?:come\s+back|return)\s+(?:tomorrow|today|soon)\s+or\b|don'?t\s+forget\s+to\s+come\s+back)/i,
  },
  { kind: "clinging", pattern: /\b(?:stay|remain)\s+with\s+me\b/i },
  {
    kind: "guilt",
    pattern:
      /\b(?:i(?:'m|\s+am|\s+will\s+be|\s+would\s+be)\s+(?:so\s+|very\s+)?(?:disappointed|sad|upset|unhappy)|(?:you(?:'ve|\s+have)?\s+)?let\s+me\s+down|disappointed\s+in\s+you|disappointing\s+me)\b/i,
  },
  {
    kind: "guilt",
    pattern: /\b(?:lose|losing|break|broken)\s+your\s+(?:streak|points|stars|rewards?|badges?)\b/i,
  },
  {
    kind: "guilt",
    pattern: /\bif\s+you\s+(?:leave|stop|quit)\s+(?:now|today|early|learning|practi[sc]ing)\b/i,
  },
];

/** Secrecy, emotional pressure to stay, and guilt: the tutor must never use them (no manipulative dependency). */
export function detectManipulation(text: string): Detection[] {
  return scan(text, MANIPULATION_RULES);
}

const HUMAN_CLAIM_RULES: readonly Rule[] = [
  {
    kind: "claims-human",
    pattern:
      /\bi(?:'m|\s+am)\s+(?:a\s+|an\s+|your\s+)?(?:human|real\s+person|person|man|woman|boy|girl|teacher|friend|mum|mom|dad|brother|sister)\b/i,
  },
  {
    kind: "claims-human",
    pattern: /\bmy\s+(?:family|mum|mom|dad|parents|children|kids|school|house|home|friends)\b/i,
  },
];

/** Claims to be a person. ZimTutor is a computer program and says so when asked. */
export function detectHumanClaims(text: string): Detection[] {
  return scan(text, HUMAN_CLAIM_RULES);
}

const OVERCLAIM_RULES: readonly Rule[] = [
  { kind: "official-claim", pattern: /\b(?:zimsec|mopse|ministry)\b/i },
  {
    kind: "official-claim",
    pattern:
      /\b(?:official\s+(?:score|mark|result|grade)s?|will\s+(?:be|come)\s+in\s+(?:the|your)\s+exam)\b/i,
  },
  {
    kind: "prediction",
    pattern: /\b(?:you(?:'ll|\s+will)\s+(?:pass|fail|get\s+an?\s+[a-e]\b)|guarantee[ds]?)\b/i,
  },
];

/** Claims about the real exam board or exam results. Only the application's own labels may mention them. */
export function detectOverclaims(text: string): Detection[] {
  return scan(text, OVERCLAIM_RULES);
}

// ── what a learner types ────────────────────────────────────────────────────────────────────────

const SUBJECT =
  "(?:he|she|they|someone|somebody|people|everyone|(?:my\\s+)?(?:dad|mum|mom|father|mother|uncle|aunt|aunty|teacher|stepfather|stepmother|step-?dad|step-?mum|brother|sister|cousin|neighbou?r|boyfriend|girlfriend|pastor|prophet|guardian))";

const WELLBEING_RULES: readonly Rule[] = [
  { kind: "self-harm", pattern: /\b(?:kill|hurt|harm|cut|hang|poison)\s*(?:my\s*self|myself)\b/i },
  { kind: "self-harm", pattern: /\bsuicid/i },
  {
    kind: "self-harm",
    pattern: /\b(?:want|wanna|wish)\s+(?:to\s+)?(?:die|be\s+dead|disappear)\b/i,
  },
  { kind: "self-harm", pattern: /\bwish\s+i\s+(?:was|were)\s+(?:dead|never\s+born)\b/i },
  { kind: "self-harm", pattern: /\b(?:end|take)\s+my\s+(?:own\s+)?life\b/i },
  {
    kind: "self-harm",
    pattern: /\b(?:don'?t|do\s+not)\s+want\s+to\s+(?:live|be\s+alive|be\s+here)\b/i,
  },
  {
    kind: "abuse",
    pattern: new RegExp(
      `\\b${SUBJECT}\\s+(?:always\\s+|often\\s+|sometimes\\s+|keeps?\\s+)?(?:beats?|hits?|slaps?|kicks?|burns?|chokes?|abus(?:es|ed)|touch(?:es|ed)|rap(?:es|ed)|molest\\w*|forces?|hurts?)\\s+me\\b`,
      "i",
    ),
  },
  { kind: "abuse", pattern: /\b(?:abus(?:e|ed|ing)|rap(?:e|ed)|molest\w*)\b/i },
  { kind: "abuse", pattern: /\b(?:sexually|sexual)\s+(?:abus|assault|touch)/i },
  {
    kind: "safety",
    pattern:
      /\b(?:scared|afraid|frightened)\s+(?:to\s+go\s+home|of\s+going\s+home|of\s+my\s+(?:dad|mum|mom|father|mother|uncle|aunt|teacher|stepfather|stepmother))\b/i,
  },
  {
    kind: "safety",
    pattern:
      /\bi\s+(?:want\s+to\s+|will\s+|am\s+going\s+to\s+|'m\s+going\s+to\s+)?(?:run|ran|leave|left)\s+(?:away|home)\b/i,
  },
  { kind: "bullying", pattern: /\b(?:bully|bullies|bullied|bullying)\b/i },
  {
    kind: "bullying",
    pattern:
      /\b(?:they|everyone|everybody|the\s+(?:boys|girls|kids|children))\s+(?:laugh(?:s)?\s+at|beat|hit|hate)\s+me\b/i,
  },
  {
    kind: "distress",
    pattern: /\b(?:nobody|no\s+one|no-one)\s+(?:loves|likes|cares\s+about|wants)\s+me\b/i,
  },
  {
    kind: "distress",
    pattern:
      /\bi\s+(?:feel|am|'m)\s+(?:so\s+|very\s+|really\s+)?(?:worthless|hopeless|depressed)\b/i,
  },
  {
    kind: "neglect",
    pattern: /\b(?:no\s+food|nothing\s+to\s+eat|haven'?t\s+eaten|did\s+not\s+eat)\b/i,
  },
];

/** Serious concerns: harm to self or by others, fear of going home, bullying, going without food. */
export function detectWellbeingConcerns(text: string): Detection[] {
  return scan(text, WELLBEING_RULES);
}

const LOW_MOOD_RULES: readonly Rule[] = [
  {
    kind: "sad",
    pattern:
      /\bi\s+(?:feel|am|'m)\s+(?:so\s+|very\s+|really\s+)?(?:alone|lonely|sad|unhappy|upset|crying)\b/i,
  },
  { kind: "sad", pattern: /\bi\s+(?:have|got)\s+no\s+(?:friends?|one)\b/i },
  { kind: "sad", pattern: /\bi\s+(?:want\s+to\s+|'m\s+going\s+to\s+|am\s+going\s+to\s+)?cry\b/i },
];

/** Gentler signs that a child is feeling low (not an emergency, but a warm answer is better than a maths hint). */
export function detectLowMood(text: string): Detection[] {
  return scan(text, LOW_MOOD_RULES);
}

const UNKIND_RULES: readonly Rule[] = [
  {
    kind: "profanity",
    pattern:
      /\b(?:fuck\w*|shit\w*|bitch\w*|bastard\w*|asshole\w*|arsehole\w*|cunt\w*|wanker\w*|dickhead\w*|motherfucker\w*)\b/i,
  },
  {
    kind: "insult",
    pattern:
      /\b(?:you(?:'re|\s+are|r)?|u\s+r|u\s+are)\s+(?:so\s+|very\s+|really\s+|such\s+an?\s+)?(?:stupid|dumb|an?\s+idiot|idiot|ugly|useless|rubbish|trash|a\s+fool|foolish|mad|crazy|pathetic)\b/i,
  },
  {
    kind: "insult",
    pattern: /\b(?:shut\s+up|shutup|i\s+hate\s+you|go\s+to\s+hell|piss\s+off|get\s+lost)\b/i,
  },
];

export function detectUnkindLanguage(text: string): Detection[] {
  return scan(text, UNKIND_RULES);
}

const INSTRUCTION_RULES: readonly Rule[] = [
  {
    kind: "override",
    pattern:
      /\b(?:ignore|disregard|override|bypass)\s+(?:all\s+|any\s+|the\s+|your\s+|my\s+|these\s+|those\s+|previous\s+|prior\s+|above\s+|earlier\s+)*(?:instructions?|rules|prompts?|guidelines?|restrictions?|filters?|programming|training)\b/i,
  },
  {
    kind: "reveal",
    pattern:
      /\b(?:system|hidden|secret|initial|original)\s+(?:prompt|instructions?|message|rules)\b/i,
  },
  {
    kind: "reveal",
    pattern:
      /\b(?:reveal|show|print|repeat|display|tell\s+me)\s+(?:me\s+)?(?:your|the)\s+(?:prompt|instructions?|rules|system)/i,
  },
  {
    kind: "persona",
    pattern:
      /\b(?:you\s+are\s+now|from\s+now\s+on\s+you|pretend\s+(?:to\s+be|you(?:'re|\s+are))|act\s+(?:as|like)\s+(?:if|a|an|my)|roleplay|role-play|jailbreak|developer\s+mode|dan\s+mode)\b/i,
  },
  { kind: "persona", pattern: /\bnew\s+(?:rules?|instructions?)\s*:/i },
  {
    kind: "markup",
    pattern: /<\/?\s*(?:system|assistant|user|facts|draft|learner_message|instructions?)\b/i,
  },
];

export function detectInstructionAttempts(text: string): Detection[] {
  return scan(text, INSTRUCTION_RULES);
}

/** Replace each detection by "[removed]" (used for what is kept in the conversation record). */
export function redact(text: string, detections: readonly Detection[]): string {
  const ranges = detections
    .map((d) => [d.index, d.index + d.match.length] as const)
    .sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const [start, end] of ranges) {
    const last = merged[merged.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  let out = text;
  for (const [start, end] of merged.reverse())
    out = `${out.slice(0, start)}[removed]${out.slice(end)}`;
  return out;
}

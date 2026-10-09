/**
 * What is limited, how much, and what a person is told when they reach it.
 *
 * The numbers are chosen so that nobody working normally ever meets them and a script, or someone
 * guessing passwords, meets them quickly. Limits per ACCOUNT are the ones that protect an individual
 * child. Limits per ADDRESS are deliberately high: a whole mobile network, or a school's computer
 * room, can appear as one internet address, so an address is never taken to be one person.
 */

export interface Limit {
  /** Hits allowed in one window. */
  max: number;
  /** Length of a window, in seconds. */
  seconds: number;
}

const HOUR = 60 * 60;
const DAY = 24 * HOUR;

export const LIMITS = {
  /** Sign-in attempts at one account (counted before the attempt; a good sign-in clears them). */
  "login.account": { max: 8, seconds: 15 * 60 },
  /** Failed sign-ins from one address, across accounts: someone trying many accounts. */
  "login.address": { max: 100, seconds: 15 * 60 },
  /** Parent accounts made from one address. */
  "signup.address": { max: 40, seconds: HOUR },
  /** Learner accounts made by one parent. */
  "learner.create": { max: 12, seconds: DAY },
  /** A learner opening lessons. */
  "tutor.start": { max: 30, seconds: 60 },
  /** A learner pressing buttons in a lesson. */
  "tutor.step": { max: 90, seconds: 60 },
  /** A learner's own questions: each may be put to a model, which costs money. */
  "tutor.ask": { max: 10, seconds: 60 },
  "tutor.ask.day": { max: 150, seconds: DAY },
  /** Emails asking for a new password, for one address: nobody needs more than a few an hour. */
  "reset.email": { max: 3, seconds: HOUR },
  /** The same, from one place. */
  "reset.address": { max: 30, seconds: HOUR },
  /** Deleting accounts: asked for rarely, and never in a hurry. */
  "account.delete": { max: 10, seconds: DAY },
  /** Changing a child's password. */
  "account.password": { max: 10, seconds: HOUR },
  /** Practice papers. */
  "exam.start": { max: 6, seconds: HOUR },
  "exam.save": { max: 150, seconds: 60 },
  "exam.finish": { max: 10, seconds: HOUR },
} as const satisfies Record<string, Limit>;

export type Bucket = keyof typeof LIMITS;

export const BUCKETS = Object.keys(LIMITS) as Bucket[];

/** "a few seconds", "a minute", "5 minutes", "about 2 hours": how long to wait, in a child's words. */
export function waitPhrase(seconds: number): string {
  const s = Math.max(1, Math.ceil(seconds));
  if (s <= 10) return "a few seconds";
  if (s <= 90) return "a minute";
  const minutes = Math.ceil(s / 60);
  if (minutes < 60) return `${minutes} minutes`;
  const hours = Math.ceil(minutes / 60);
  return hours === 1 ? "about an hour" : `about ${hours} hours`;
}

/** What a person is told when a limit is reached. It never says whose count it was. */
export function refusalFor(bucket: Bucket, retryAfterSeconds: number): string {
  const wait = waitPhrase(retryAfterSeconds);
  switch (bucket) {
    case "login.account":
    case "login.address":
      return `Too many tries. Please wait ${wait} and try again, or ask a grown-up to help.`;
    case "signup.address":
      return `Too many accounts have been made from here. Please try again in ${wait}.`;
    case "learner.create":
      return `You have added a lot of learners today. Please try again in ${wait}.`;
    case "reset.email":
    case "reset.address":
      return `A lot of requests have been made. Please try again in ${wait}.`;
    case "account.delete":
    case "account.password":
      return `That has been done a lot just now. Please try again in ${wait}.`;
    case "tutor.ask.day":
      return "You have asked a lot of questions today. Carry on with the practice, and ask more tomorrow.";
    case "exam.start":
      return `You have started a lot of papers just now. Please try again in ${wait}.`;
    case "exam.finish":
      return `You have finished a lot of papers just now. Please try again in ${wait}.`;
    case "tutor.start":
    case "tutor.step":
    case "tutor.ask":
    case "exam.save":
      return `You are going a little fast. Please wait ${wait} and try again.`;
  }
}

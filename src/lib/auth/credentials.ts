import { z } from "zod";

/**
 * Credential rules for ZimTutor accounts.
 *
 * Learners are children and are NOT asked for an email address. A parent creates the learner;
 * the learner signs in with a username. Supabase Auth requires an email-shaped identifier, so
 * each learner gets a synthetic one on a reserved, undeliverable domain (RFC 6761 `.invalid`):
 * no message can ever be routed to a real inbox, and no personal data is stored in it.
 */

export const LEARNER_EMAIL_DOMAIN = "learners.zimtutor.invalid";

/** Must stay in sync with the CHECK constraint on learner_profiles.username. */
export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9_.-]{2,23}$/;

/** Mirrors the limit enforced inside provision_learner_profile(). */
export const MAX_LEARNERS_PER_PARENT = 8;

export const PASSWORD_MIN_LENGTH = 8;
/** bcrypt (used by Supabase Auth) silently ignores bytes after 72. */
export const PASSWORD_MAX_LENGTH = 72;

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

export function learnerEmail(username: string): string {
  return `${normalizeUsername(username)}@${LEARNER_EMAIL_DOMAIN}`;
}

export function isLearnerEmail(email: string): boolean {
  return email.toLowerCase().endsWith(`@${LEARNER_EMAIL_DOMAIN}`);
}

const COMMON_PASSWORDS = new Set([
  "password",
  "password1",
  "password123",
  "12345678",
  "123456789",
  "1234567890",
  "11111111",
  "00000000",
  "qwertyui",
  "qwerty123",
  "iloveyou",
  "abcd1234",
  "zimbabwe",
  "zimbabwe1",
  "zimtutor",
  "letmein1",
  "welcome1",
]);

export function isCommonPassword(password: string): boolean {
  return COMMON_PASSWORDS.has(password.toLowerCase());
}

/**
 * A display name is shown to the child and (for parents) stored. It should be a first name or
 * nickname, never contact details, so obvious contact patterns are rejected up front.
 */
export function looksLikeContactDetails(value: string): boolean {
  const v = value.toLowerCase();
  if (/[@]/.test(v)) return true; // email handles
  if (/(https?:|www\.|\.com\b|\.co\.zw\b|\.org\b)/.test(v)) return true; // links
  if (/\d[\d\s().+-]{5,}\d/.test(v)) return true; // phone-number-like runs
  return false;
}

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

export const displayNameSchema = z
  .string()
  .trim()
  .min(1, "Please enter a name.")
  .max(40, "Please use 40 characters or fewer.")
  .refine((v) => !CONTROL_CHARS.test(v), "That name contains characters we can't use.")
  .refine((v) => !looksLikeContactDetails(v), "Please use just a first name or a nickname.");

export const usernameSchema = z
  .string()
  .transform(normalizeUsername)
  .pipe(
    z
      .string()
      .regex(
        USERNAME_PATTERN,
        "Use 3–24 letters, numbers, dots, dashes or underscores, starting with a letter or number.",
      ),
  );

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters.`)
  .max(PASSWORD_MAX_LENGTH, `Use ${PASSWORD_MAX_LENGTH} characters or fewer.`)
  .refine((v) => !isCommonPassword(v), "That password is too easy to guess. Try a short phrase.");

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email("Please enter a valid email address."))
  .refine((v) => !isLearnerEmail(v), "Please use your own email address.");

export const gradeSchema = z.coerce
  .number()
  .int()
  .min(3, "Choose a grade from 3 to 7.")
  .max(7, "Choose a grade from 3 to 7.");

export const parentSignUpSchema = z.object({
  displayName: displayNameSchema,
  email: emailSchema,
  password: passwordSchema,
  // The parent/guardian must affirm they are an adult responsible for any learner they add.
  isGuardian: z.literal("on", { error: "Please confirm you are a parent or guardian." }),
});

export const parentSignInSchema = z.object({
  email: z.string().trim().toLowerCase().min(1),
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});

export const learnerSignInSchema = z.object({
  username: z.string().transform(normalizeUsername).pipe(z.string().min(1).max(24)),
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});

export const createLearnerSchema = z
  .object({
    displayName: displayNameSchema,
    username: usernameSchema,
    password: passwordSchema,
    grade: gradeSchema,
  })
  .refine((v) => v.password.toLowerCase() !== v.username, {
    path: ["password"],
    message: "The password can't be the same as the username.",
  });

export type CreateLearnerInput = z.infer<typeof createLearnerSchema>;

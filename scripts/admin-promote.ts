/**
 * Promote (or demote) an administrator. Needs direct database access, by design.
 *
 *   npm run admin:promote -- someone@example.com
 *   npm run admin:promote -- someone@example.com --revoke
 *
 * The person must already have signed up (as a parent). Learner accounts, and parents who have
 * linked learners, are refused: use a separate account for administration.
 */
import postgres from "postgres";
import { config } from "dotenv";
import { setAdminRole } from "../src/lib/db/admin";

config({ path: [".env.local", ".env"], quiet: true });

async function main() {
  const args = process.argv.slice(2);
  const revoke = args.includes("--revoke");
  const email = args.find((a) => !a.startsWith("--"));
  if (!email) {
    console.error("Usage: npm run admin:promote -- <email> [--revoke]");
    process.exit(1);
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set (see .env.example).");
    process.exit(1);
  }
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const { status } = await setAdminRole(sql, email, { revoke });
    const outcomes: Record<typeof status, { ok: boolean; text: string }> = {
      PROMOTED: { ok: true, text: `${email} is now an administrator.` },
      ALREADY_ADMIN: { ok: true, text: `${email} is already an administrator.` },
      REVOKED: { ok: true, text: `${email} is no longer an administrator (now a parent account).` },
      NOT_ADMIN: { ok: true, text: `${email} is not an administrator; nothing to revoke.` },
      NOT_FOUND: {
        ok: false,
        text: `No account with the email ${email}. They must sign up first.`,
      },
      REFUSED_LEARNER_ACCOUNT: {
        ok: false,
        text: "Refused: that is a learner account. Learners can never be administrators.",
      },
      REFUSED_HAS_LEARNERS: {
        ok: false,
        text: "Refused: that parent has linked learners. Sign up a separate account for administration.",
      },
    };
    const outcome = outcomes[status];
    (outcome.ok ? console.log : console.error)(outcome.text);
    process.exitCode = outcome.ok ? 0 : 1;
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

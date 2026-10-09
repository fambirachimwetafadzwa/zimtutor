import { createHmac } from "node:crypto";

/**
 * The key that rate-limit hashes are made with: RATE_LIMIT_SECRET when it is set, otherwise a key
 * made from the service key (which only the server has), so that a deployment with no extra
 * setting still keeps nothing that can be reversed.
 */
export function rateLimitSecret(env: {
  rateLimitSecret?: string | undefined;
  supabaseServiceRoleKey: string;
}): string {
  return (
    env.rateLimitSecret ??
    createHmac("sha256", env.supabaseServiceRoleKey).update("zimtutor rate limit v1").digest("hex")
  );
}

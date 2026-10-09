import "server-only";
import { headers } from "next/headers";
import { readServerEnv } from "@/lib/env";
import { logError } from "@/lib/log";
import { getMonitor, later } from "@/lib/monitoring";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { clientAddress, trustedAddressHeader } from "./address";
import { createLimiter, type Limiter } from "./limiter";
import type { Bucket } from "./policy";
import { rateLimitSecret } from "./secret";
import { SupabaseRateLimitPort } from "./store";
import { subjectHash } from "./subject";

/** The limiter the running application uses: counters in the database, keyed by a server secret. */
export function createRateLimiter(): Limiter {
  const secret = rateLimitSecret(readServerEnv());
  return createLimiter({
    port: new SupabaseRateLimitPort(createSupabaseAdminClient()),
    hash: (bucket, subject) => subjectHash(secret, bucket, subject),
    onError: (error, bucket) => logError("rate_limit_unavailable", error, { bucket }),
    onRefused: (bucket) => later(getMonitor().track({ name: "limit_reached", bucket })),
  });
}

/** The address of the visitor making this request, if a header that can be believed says (see address.ts). */
export async function requestAddress(): Promise<string | null> {
  const header = trustedAddressHeader({
    clientIpHeader: readServerEnv().clientIpHeader,
    onVercel: Boolean(process.env.VERCEL),
  });
  return clientAddress(await headers(), header);
}

/**
 * Count one hit for this action. Returns what to tell the person when the limit is reached, or null
 * when they may go ahead.
 */
export async function refusal(bucket: Bucket, subject: string): Promise<string | null> {
  const verdict = await createRateLimiter().hit(bucket, subject);
  return verdict.allowed ? null : verdict.message;
}

import { z } from "zod";

/**
 * Environment access.
 *
 * Validation is LAZY (on first use, not at import) so `next build` and unit tests never need
 * secrets, while a misconfigured runtime fails with a precise message instead of an obscure
 * network error.
 */

export class EnvError extends Error {
  constructor(
    message: string,
    readonly missing: string[],
  ) {
    super(message);
    this.name = "EnvError";
  }
}

const nonEmpty = z.string().trim().min(1);

const publicSchema = z.object({
  supabaseUrl: z.url(),
  supabaseAnonKey: nonEmpty,
  siteUrl: z.url(),
});

const serverSchema = z.object({
  supabaseServiceRoleKey: nonEmpty,
  aiProvider: z.enum(["anthropic", "openai-compatible", "mock"]),
  aiModel: z.string().optional(),
  aiEffort: z.enum(["low", "medium", "high", "xhigh", "max"]).optional(),
  anthropicApiKey: z.string().optional(),
  openaiCompatibleBaseUrl: z.string().optional(),
  openaiCompatibleApiKey: z.string().optional(),
  childHelplineName: z.string().optional(),
  childHelplineNumber: z.string().optional(),
  embeddingProvider: z.enum(["openai-compatible", "local-hash"]),
  embeddingModel: z.string(),
  embeddingApiKey: z.string().optional(),
  embeddingBaseUrl: z.string().optional(),
});

export type PublicEnv = z.infer<typeof publicSchema>;
export type ServerEnv = z.infer<typeof serverSchema>;

function blankToUndefined(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === "" ? undefined : value;
}

function fail(scope: string, error: z.ZodError, names: Record<string, string>): never {
  const missing = [
    ...new Set(error.issues.map((i) => names[String(i.path[0])] ?? String(i.path[0]))),
  ];
  throw new EnvError(`Invalid ${scope} environment configuration: ${missing.join(", ")}`, missing);
}

const publicNames: Record<string, string> = {
  supabaseUrl: "NEXT_PUBLIC_SUPABASE_URL",
  supabaseAnonKey: "NEXT_PUBLIC_SUPABASE_ANON_KEY (or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)",
  siteUrl: "NEXT_PUBLIC_SITE_URL",
};

const serverNames: Record<string, string> = {
  supabaseServiceRoleKey: "SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY)",
  aiProvider: "AI_PROVIDER",
  aiEffort: "AI_EFFORT (low, medium, high, xhigh or max)",
  embeddingProvider: "EMBEDDING_PROVIDER",
  embeddingModel: "EMBEDDING_MODEL",
};

/**
 * Next.js inlines `process.env.NEXT_PUBLIC_*` only for LITERAL property accesses, so each public
 * variable is read explicitly here rather than via a dynamic key.
 */
export function readPublicEnv(): PublicEnv {
  const parsed = publicSchema.safeParse({
    supabaseUrl: blankToUndefined(process.env.NEXT_PUBLIC_SUPABASE_URL),
    supabaseAnonKey: blankToUndefined(
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    ),
    siteUrl: blankToUndefined(process.env.NEXT_PUBLIC_SITE_URL) ?? "http://localhost:3000",
  });
  if (!parsed.success) fail("public", parsed.error, publicNames);
  return parsed.data;
}

/** True when the public Supabase settings are present (lets pages show a helpful notice instead of crashing). */
export function isPublicEnvConfigured(): boolean {
  try {
    readPublicEnv();
    return true;
  } catch (error) {
    if (error instanceof EnvError) return false;
    throw error;
  }
}

let cachedServerEnv: ServerEnv | undefined;

/** Server-only configuration. Never call from client components. */
export function readServerEnv(): ServerEnv {
  if (cachedServerEnv) return cachedServerEnv;
  const e = process.env;
  const parsed = serverSchema.safeParse({
    supabaseServiceRoleKey: blankToUndefined(e.SUPABASE_SERVICE_ROLE_KEY ?? e.SUPABASE_SECRET_KEY),
    aiProvider: blankToUndefined(e.AI_PROVIDER) ?? "mock",
    aiModel: blankToUndefined(e.AI_MODEL),
    aiEffort: blankToUndefined(e.AI_EFFORT),
    anthropicApiKey: blankToUndefined(e.ANTHROPIC_API_KEY),
    openaiCompatibleBaseUrl: blankToUndefined(e.OPENAI_COMPATIBLE_BASE_URL),
    openaiCompatibleApiKey: blankToUndefined(e.OPENAI_COMPATIBLE_API_KEY),
    childHelplineName: blankToUndefined(e.CHILD_HELPLINE_NAME),
    childHelplineNumber: blankToUndefined(e.CHILD_HELPLINE_NUMBER),
    embeddingProvider: blankToUndefined(e.EMBEDDING_PROVIDER) ?? "local-hash",
    embeddingModel: blankToUndefined(e.EMBEDDING_MODEL) ?? "text-embedding-3-small",
    embeddingApiKey: blankToUndefined(e.EMBEDDING_API_KEY),
    embeddingBaseUrl: blankToUndefined(e.EMBEDDING_BASE_URL),
  });
  if (!parsed.success) fail("server", parsed.error, serverNames);

  const env = parsed.data;
  const missing: string[] = [];
  if (env.aiProvider === "anthropic") {
    if (!env.anthropicApiKey) missing.push("ANTHROPIC_API_KEY");
    if (!env.aiModel) missing.push("AI_MODEL");
  }
  if (env.aiProvider === "openai-compatible") {
    if (!env.openaiCompatibleBaseUrl) missing.push("OPENAI_COMPATIBLE_BASE_URL");
    if (!env.aiModel) missing.push("AI_MODEL");
  }
  if (env.embeddingProvider === "openai-compatible" && !env.embeddingApiKey) {
    missing.push("EMBEDDING_API_KEY");
  }
  if (missing.length > 0) {
    throw new EnvError(
      `Invalid server environment configuration: ${missing.join(", ")} required for the selected provider`,
      missing,
    );
  }
  cachedServerEnv = env;
  return env;
}

/** Test hook: forget cached server configuration. */
export function resetEnvCacheForTests(): void {
  cachedServerEnv = undefined;
}

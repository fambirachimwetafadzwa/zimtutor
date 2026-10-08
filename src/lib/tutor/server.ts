import "server-only";
import { embeddingProviderFromEnv } from "@/lib/ai/embeddings";
import { llmProviderFromEnv } from "@/lib/ai/llm/factory";
import { helplineFromSettings } from "@/lib/ai/safety";
import { readServerEnv } from "@/lib/env";
import { logEvent } from "@/lib/log";
import { SupabaseBankStore } from "@/lib/questions/bank";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createRetriever, SupabaseSearchPort } from "./retrieval";
import type { TutorDeps } from "./service";
import { SupabaseCurriculumPort } from "./supabase-curriculum";
import { SupabaseTutorStore } from "./supabase-store";
import { createVoice, type TutorVoice } from "./voice";

/**
 * The tutor wired to the running application: the service-role client (only ever used after the
 * calling action has authenticated the learner), the configured language model, embeddings and
 * helpline. One voice is kept for the life of the server process so its circuit breaker remembers
 * that a model has been failing.
 */

let sharedVoice: { key: string; voice: TutorVoice } | undefined;

function voiceFor(env: ReturnType<typeof readServerEnv>): TutorVoice {
  // "mock" means no model at all: the plain template text, never labelled as a model's.
  const key = [env.aiProvider, env.aiModel, env.aiEffort].join("|");
  if (sharedVoice?.key === key) return sharedVoice.voice;
  const voice = createVoice({
    provider: env.aiProvider === "mock" ? null : llmProviderFromEnv(env),
    onEvent: (event) => logEvent("voice", event as unknown as Record<string, unknown>),
  });
  sharedVoice = { key, voice };
  return voice;
}

export function createTutorDeps(): TutorDeps {
  const env = readServerEnv();
  const service = createSupabaseAdminClient();
  return {
    store: new SupabaseTutorStore(service),
    bank: new SupabaseBankStore(service),
    curriculum: new SupabaseCurriculumPort(service),
    retriever: createRetriever(new SupabaseSearchPort(service), embeddingProviderFromEnv()),
    voice: voiceFor(env),
    helpline: helplineFromSettings({
      name: env.childHelplineName,
      number: env.childHelplineNumber,
    }),
    onEvent: (event) => logEvent("tutor", event as unknown as Record<string, unknown>),
  };
}

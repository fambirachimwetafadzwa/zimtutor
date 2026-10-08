import "server-only";
import { logEvent } from "@/lib/log";
import { SupabaseBankStore } from "@/lib/questions/bank";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { ExamDeps } from "./service";

/**
 * Practice papers wired to the running application: the service-role client, which is only ever used
 * after the calling action has authenticated the learner.
 */
export function createExamDeps(): ExamDeps {
  const service = createSupabaseAdminClient();
  return {
    service,
    bank: new SupabaseBankStore(service),
    onEvent: (event) => logEvent("exam", event as unknown as Record<string, unknown>),
  };
}

import "server-only";
import { logError, logEvent } from "@/lib/log";
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
    onEvent: (event) => {
      logEvent("exam", event as unknown as Record<string, unknown>);
      // a paper that was marked but whose answers did not all reach the child's record is a fault
      // someone has to hear about (it also goes to the monitor, if one is on)
      if (event.type === "paper_evidence_failed")
        logError(
          "paper_evidence_failed",
          new Error("a marked paper's answers were not all added to the learner's record"),
        );
    },
  };
}

import type { SupabaseClient } from "@supabase/supabase-js";
import { loadPath, type Path } from "./path";

/**
 * The syllabus path is the same for every learner and changes only when a new syllabus is loaded, so
 * a server keeps it for a few minutes instead of reading ~450 objectives on every page view. It holds
 * no one's records.
 */

const KEEP_MS = 10 * 60_000;
let kept: { at: number; path: Path } | null = null;

export async function cachedPath(db: SupabaseClient, now: number = Date.now()): Promise<Path> {
  if (kept && now - kept.at < KEEP_MS) return kept.path;
  const path = await loadPath(db);
  kept = { at: now, path };
  return path;
}

/** For tests, and after loading a new syllabus. */
export function forgetPath(): void {
  kept = null;
}

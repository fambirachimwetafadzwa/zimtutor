import type { ObjectiveInfo, QuestionTemplate } from "../questions/types";
import { ALL_TEMPLATES } from "../questions/templates";
import type { Path, PathObjective } from "./path";

/** An objective as the question templates see it. */
export function toObjectiveInfo(o: PathObjective): ObjectiveInfo {
  return {
    id: o.id,
    text: o.text,
    grade: o.grade,
    topicCode: o.topicCode,
    subtopicId: o.subtopicId,
    strandKey: o.strandKey,
    subtopicShortName: o.subtopicShortName,
    ordinalInSubtopic: o.ordinalInSubtopic,
  };
}

const cache = new WeakMap<Path, Map<readonly QuestionTemplate[], ReadonlySet<string>>>();

/**
 * The objectives that have machine-marked practice. Objectives without it (drawing, building,
 * collecting data) are taught and done with real materials; they cannot move mastery, so the planner
 * and the progress summaries leave them out.
 */
export function practicableObjectiveIds(
  path: Path,
  templates: readonly QuestionTemplate[] = ALL_TEMPLATES,
): ReadonlySet<string> {
  const byTemplates = cache.get(path) ?? new Map();
  const cached = byTemplates.get(templates);
  if (cached) return cached;
  const ids = new Set(
    path.all.filter((o) => templates.some((t) => t.covers(toObjectiveInfo(o)))).map((o) => o.id),
  );
  byTemplates.set(templates, ids);
  cache.set(path, byTemplates);
  return ids;
}

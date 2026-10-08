import type { ObjectiveInfo, QuestionTemplate } from "./types";

/**
 * Which objectives can ZimTutor generate practice for, and which not yet. An objective with no
 * template is never silently skipped: it is reported here, and the tutor says plainly that it has no
 * machine-marked practice for it (hands-on objectives such as "construct models of solid shapes" or
 * "collect data from their environment" are meant to be done with real materials).
 */

export interface CoverageRow {
  objective: ObjectiveInfo;
  templateIds: string[];
}

export interface CoverageReport {
  rows: CoverageRow[];
  covered: CoverageRow[];
  uncovered: CoverageRow[];
  /** Templates that cover no objective at all (dead code). */
  unusedTemplates: string[];
}

export function coverageReport(
  objectives: readonly ObjectiveInfo[],
  templates: readonly QuestionTemplate[],
): CoverageReport {
  const rows = objectives.map((objective) => ({
    objective,
    templateIds: templates.filter((t) => t.covers(objective)).map((t) => t.id),
  }));
  const used = new Set(rows.flatMap((r) => r.templateIds));
  return {
    rows,
    covered: rows.filter((r) => r.templateIds.length > 0),
    uncovered: rows.filter((r) => r.templateIds.length === 0),
    unusedTemplates: templates.filter((t) => !used.has(t.id)).map((t) => t.id),
  };
}

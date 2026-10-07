import type { CurriculumSnapshot } from "./snapshot";

/** Stable JSON: two-space indent and a trailing newline, so diffs are reviewable and runs byte-identical. */
export function serializeSnapshot(snapshot: CurriculumSnapshot): string {
  return `${JSON.stringify(snapshot, null, 2)}\n`;
}

/** Human-readable counts per grade/topic, for the console and for eyeballing a run. */
export function summarizeSnapshot(s: CurriculumSnapshot): string {
  const lines: string[] = [];
  lines.push(
    `Document: ${s.document.title} (${s.document.page_count} pages, sha256 ${s.document.sha256.slice(0, 12)}…)`,
  );
  lines.push(
    `Totals: ${s.grades.length} grades · ${s.topics.length} topics · ${s.subtopics.length} sub-topics · ${s.competency_rows.length} rows · ` +
      `${s.objectives.length} objectives · ${s.content.length} content · ${s.activities.length} activities · ${s.resources.length} resources`,
  );
  lines.push("");
  lines.push("grade topic  subtopics rows objectives content activities resources");
  for (const t of s.topics) {
    const subs = s.subtopics.filter((x) => x.topic_id === t.id);
    const rowIds = new Set(
      s.competency_rows.filter((r) => subs.some((x) => x.id === r.subtopic_id)).map((r) => r.id),
    );
    const count = (xs: Array<{ competency_row_id: string }>) =>
      xs.filter((x) => rowIds.has(x.competency_row_id)).length;
    const objs = s.objectives.filter((o) => subs.some((x) => x.id === o.subtopic_id)).length;
    lines.push(
      `${t.grade_id.padEnd(5)} ${t.code.padEnd(5)} ${String(subs.length).padStart(9)} ${String(rowIds.size).padStart(4)} ${String(objs).padStart(10)} ` +
        `${String(count(s.content)).padStart(7)} ${String(count(s.activities)).padStart(10)} ${String(count(s.resources)).padStart(9)}`,
    );
  }
  lines.push("");
  lines.push(
    `Assessment: ${s.assessment.components.map((c) => `${c.id} ${c.weighting_percent}%`).join(", ")} · ${s.assessment.papers.length} papers · ` +
      `${s.assessment.skill_bands.length} skill-band cells · ${s.assessment.objectives.length} objectives · ${s.assessment.project_stages.length} project stages`,
  );
  lines.push(
    `Scope & sequence entries: ${s.scope_sequence.length} · prose sections: ${s.sections.length} · warnings: ${s.warnings.length}`,
  );
  return lines.join("\n");
}

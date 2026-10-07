import { textHash } from "./ids";
import { TOPIC_CODES, TOPIC_NAMES, type CurriculumSnapshot, type Source } from "./snapshot";

/**
 * Snapshot validation (spec §21). Runs on the snapshot alone, so it can gate any file — fresh from
 * the extractor, committed in git, or about to be loaded into the database.
 *
 * ERRORS mean the curriculum is structurally unsound and must not be loaded: missing grades/topics,
 * orphaned or mis-parented records, duplicate identifiers, missing provenance, pages outside the
 * topic they belong to. WARNINGS are properties of the SOURCE that a human should know about
 * (the syllabus repeats an objective; a name starts in lower case) but that are not defects in
 * the pipeline.
 */

export interface ValidationIssue {
  severity: "error" | "warning";
  code: string;
  message: string;
  ref?: string;
}

export interface ValidationOptions {
  /** Grades that must be present. Defaults to Grade 3–7 (the syllabus scope). */
  expectedGrades?: number[];
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

export function validateSnapshot(
  snapshot: CurriculumSnapshot,
  options: ValidationOptions = {},
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const error = (code: string, message: string, ref?: string) =>
    issues.push({ severity: "error", code, message, ref });
  const warn = (code: string, message: string, ref?: string) =>
    issues.push({ severity: "warning", code, message, ref });

  const expectedGrades = options.expectedGrades ?? [3, 4, 5, 6, 7];
  const pageCount = snapshot.document.page_count;

  // ── unique identifiers ────────────────────────────────────────────────────────────────────
  const idSets = {
    grade: new Set<string>(),
    topic: new Set<string>(),
    subtopic: new Set<string>(),
    row: new Set<string>(),
    objective: new Set<string>(),
  };
  const addUnique = (kind: keyof typeof idSets, id: string) => {
    if (idSets[kind].has(id)) error("DUPLICATE_ID", `Duplicate ${kind} id "${id}"`, id);
    idSets[kind].add(id);
  };
  for (const g of snapshot.grades) addUnique("grade", g.id);
  for (const t of snapshot.topics) addUnique("topic", t.id);
  for (const s of snapshot.subtopics) addUnique("subtopic", s.id);
  for (const r of snapshot.competency_rows) addUnique("row", r.id);
  for (const o of snapshot.objectives) addUnique("objective", o.id);
  for (const kind of ["content", "activities", "resources"] as const) {
    const seen = new Set<string>();
    for (const item of snapshot[kind]) {
      if (seen.has(item.id)) error("DUPLICATE_ID", `Duplicate ${kind} id "${item.id}"`, item.id);
      seen.add(item.id);
    }
  }

  // ── missing grades / topics ───────────────────────────────────────────────────────────────
  const gradeNumbers = new Set(snapshot.grades.map((g) => g.number));
  for (const n of expectedGrades) {
    if (!gradeNumbers.has(n))
      error("MISSING_GRADE", `Grade ${n} is missing from the curriculum`, `G${n}`);
  }
  for (const g of snapshot.grades) {
    if (g.id !== `G${g.number}`)
      error("INVALID_GRADE", `Grade id "${g.id}" does not match its number ${g.number}`, g.id);
    for (const code of TOPIC_CODES) {
      if (!snapshot.topics.some((t) => t.grade_id === g.id && t.code === code)) {
        error("MISSING_TOPIC", `${g.id} has no "${TOPIC_NAMES[code]}" topic`, `${g.id}-${code}`);
      }
    }
  }

  const subjectIds = new Set(snapshot.subjects.map((s) => s.id));
  const topicById = new Map(snapshot.topics.map((t) => [t.id, t]));
  const subtopicById = new Map(snapshot.subtopics.map((s) => [s.id, s]));
  const rowById = new Map(snapshot.competency_rows.map((r) => [r.id, r]));

  // ── topics: names, relationships, page spans ──────────────────────────────────────────────
  const orderedTopics = [...snapshot.topics].sort((a, b) => a.source.page - b.source.page);
  const topicSpan = new Map<string, [number, number]>();
  orderedTopics.forEach((t, i) => {
    const next = orderedTopics[i + 1];
    topicSpan.set(t.id, [t.source.page, next ? next.source.page : pageCount]);
    if (!idSets.grade.has(t.grade_id))
      error("ORPHAN_TOPIC", `Topic ${t.id} references unknown grade ${t.grade_id}`, t.id);
    if (!subjectIds.has(t.subject_id))
      error("ORPHAN_TOPIC", `Topic ${t.id} references unknown subject ${t.subject_id}`, t.id);
    if (t.id !== `${t.grade_id}-${t.code}`)
      error(
        "INVALID_GRADE_TOPIC",
        `Topic id "${t.id}" does not match grade ${t.grade_id} and code ${t.code}`,
        t.id,
      );
    if (t.name !== TOPIC_NAMES[t.code])
      error(
        "INVALID_TOPIC_NAME",
        `Topic ${t.id} is named "${t.name}" but the official name is "${TOPIC_NAMES[t.code]}"`,
        t.id,
      );
    const gradeInHeading = /\(GRADE\s*(\d+)\)/i.exec(t.heading_text)?.[1];
    if (gradeInHeading !== undefined && `G${gradeInHeading}` !== t.grade_id) {
      error(
        "INVALID_GRADE_TOPIC",
        `Topic ${t.id} sits under a heading for Grade ${gradeInHeading}: "${t.heading_text}"`,
        t.id,
      );
    }
    checkSource(t.source, "topic", t.id);
  });

  // ── sources and page ranges ───────────────────────────────────────────────────────────────
  function checkSource(source: Source, kind: string, id: string, span?: [number, number]) {
    const { page, page_end: end } = source;
    if (!Number.isInteger(page) || page < 1 || page > pageCount) {
      error(
        "MISSING_SOURCE_PAGE",
        `${kind} ${id} has source page ${page}, outside 1–${pageCount}`,
        id,
      );
    }
    if (end !== null && (end < page || end > pageCount)) {
      error("MISSING_SOURCE_PAGE", `${kind} ${id} has an invalid end page ${end}`, id);
    }
    if (source.source_text.trim() === "")
      error("MISSING_SOURCE_TEXT", `${kind} ${id} has no source text`, id);
    if (source.page_label === null)
      warn("MISSING_PAGE_LABEL", `${kind} ${id} (page ${page}) has no printed page label`, id);
    if (span) {
      const last = end ?? page;
      if (page < span[0] || last > span[1]) {
        error(
          "PAGE_OUTSIDE_TOPIC",
          `${kind} ${id} cites pages ${page}–${last}, outside its topic's pages ${span[0]}–${span[1]}`,
          id,
        );
      }
    }
  }

  // ── sub-topics ────────────────────────────────────────────────────────────────────────────
  const subtopicsByTopic = new Map<string, typeof snapshot.subtopics>();
  for (const s of snapshot.subtopics) {
    const topic = topicById.get(s.topic_id);
    if (!topic) {
      error("ORPHAN_SUBTOPIC", `Sub-topic ${s.id} references unknown topic ${s.topic_id}`, s.id);
      continue;
    }
    if (!s.id.startsWith(`${topic.id}-`))
      error(
        "INVALID_GRADE_TOPIC",
        `Sub-topic id "${s.id}" does not belong to topic ${topic.id}`,
        s.id,
      );
    if (s.name.trim() === "") error("MISSING_NAME", `Sub-topic ${s.id} has no name`, s.id);
    if (/^[a-z0-9(]/.test(s.name))
      warn(
        "LOWERCASE_NAME",
        `Sub-topic ${s.id} name starts mid-sentence: "${s.name.slice(0, 60)}" (check it is not a wrapped fragment)`,
        s.id,
      );
    checkSource(s.source, "sub-topic", s.id, topicSpan.get(topic.id));
    const list = subtopicsByTopic.get(topic.id) ?? [];
    list.push(s);
    subtopicsByTopic.set(topic.id, list);
  }
  for (const t of snapshot.topics) {
    const subs = subtopicsByTopic.get(t.id) ?? [];
    if (subs.length === 0) error("MISSING_SUBTOPICS", `Topic ${t.id} has no sub-topics`, t.id);
    checkOrdinals(
      subs.map((s) => s.ordinal),
      `sub-topics of ${t.id}`,
      t.id,
    );
  }

  // ── rows ──────────────────────────────────────────────────────────────────────────────────
  const rowsBySubtopic = new Map<string, typeof snapshot.competency_rows>();
  for (const r of snapshot.competency_rows) {
    const sub = subtopicById.get(r.subtopic_id);
    if (!sub) {
      error("ORPHAN_ROW", `Row ${r.id} references unknown sub-topic ${r.subtopic_id}`, r.id);
      continue;
    }
    if (!r.id.startsWith(`${sub.id}.R`))
      error("INVALID_ROW_ID", `Row id "${r.id}" does not belong to sub-topic ${sub.id}`, r.id);
    checkSource(r.source, "row", r.id, topicSpan.get(sub.topic_id));
    const list = rowsBySubtopic.get(sub.id) ?? [];
    list.push(r);
    rowsBySubtopic.set(sub.id, list);
  }
  for (const s of snapshot.subtopics) {
    const rows = rowsBySubtopic.get(s.id) ?? [];
    if (rows.length === 0)
      error("SUBTOPIC_WITHOUT_ROWS", `Sub-topic ${s.id} has no competency rows`, s.id);
    checkOrdinals(
      rows.map((r) => r.ordinal),
      `rows of ${s.id}`,
      s.id,
    );
  }

  // ── objectives ────────────────────────────────────────────────────────────────────────────
  const objectivesByRow = new Map<string, typeof snapshot.objectives>();
  const objectivesBySubtopic = new Map<string, typeof snapshot.objectives>();
  for (const o of snapshot.objectives) {
    const sub = subtopicById.get(o.subtopic_id);
    const row = rowById.get(o.competency_row_id);
    if (!sub) {
      error("ORPHAN_OBJECTIVE", `Objective ${o.id} has no sub-topic (${o.subtopic_id})`, o.id);
      continue;
    }
    if (!row) {
      error(
        "ORPHAN_OBJECTIVE",
        `Objective ${o.id} has no competency row (${o.competency_row_id})`,
        o.id,
      );
      continue;
    }
    if (row.subtopic_id !== sub.id) {
      error(
        "INVALID_GRADE_TOPIC",
        `Objective ${o.id} sits in row ${row.id}, which belongs to a different sub-topic (${row.subtopic_id})`,
        o.id,
      );
    }
    if (!/^G\d{1,2}-(NUM|OPS|MEA|REL)-[A-Z0-9]+(-[A-Z0-9]+)*-\d{3}$/.test(o.id))
      error("INVALID_ID", `Objective id "${o.id}" is not in the stable-id format`, o.id);
    if (o.id !== `${sub.id}-${String(o.ordinal_in_subtopic).padStart(3, "0")}`)
      error("INVALID_ID", `Objective id "${o.id}" does not match its sub-topic and ordinal`, o.id);
    if (o.text_hash !== textHash(o.text))
      error("TEXT_HASH_MISMATCH", `Objective ${o.id} has a stale text hash`, o.id);
    if (
      o.normalizations.includes("SUPERSCRIPT_UNMAPPED") &&
      !o.normalizations.includes("REVIEWED_OVERRIDE")
    ) {
      error(
        "UNREVIEWED_TEXT",
        `Objective ${o.id} contains unmapped superscript text that no person has reviewed`,
        o.id,
      );
    }
    const topic = topicById.get(sub.topic_id);
    checkSource(o.source, "objective", o.id, topic ? topicSpan.get(topic.id) : undefined);
    for (const [map, key] of [
      [objectivesByRow, o.competency_row_id],
      [objectivesBySubtopic, o.subtopic_id],
    ] as const) {
      const list = map.get(key) ?? [];
      list.push(o);
      map.set(key, list);
    }
  }
  for (const r of snapshot.competency_rows) {
    const list = objectivesByRow.get(r.id) ?? [];
    if (list.length === 0)
      error(
        "ROW_WITHOUT_OBJECTIVES",
        `Row ${r.id} has no learning objectives (pages ${r.source.page}–${r.source.page_end ?? r.source.page})`,
        r.id,
      );
    checkOrdinals(
      list.map((o) => o.ordinal_in_row),
      `objectives of ${r.id}`,
      r.id,
    );
  }
  for (const s of snapshot.subtopics) {
    checkOrdinals(
      (objectivesBySubtopic.get(s.id) ?? []).map((o) => o.ordinal_in_subtopic),
      `objectives of ${s.id}`,
      s.id,
    );
    // The syllabus itself sometimes repeats an objective (e.g. Grade 4 "interpret information from bar graphs"):
    // report it, since an extraction bug could cause the same symptom.
    const seen = new Map<string, string>();
    for (const o of objectivesBySubtopic.get(s.id) ?? []) {
      const key = norm(o.text);
      const earlier = seen.get(key);
      if (earlier)
        warn(
          "DUPLICATE_OBJECTIVE_TEXT",
          `Objectives ${earlier} and ${o.id} have identical wording: "${o.text}"`,
          o.id,
        );
      else seen.set(key, o.id);
    }
  }

  // ── row items (content / activities / resources) ──────────────────────────────────────────
  for (const kind of ["content", "activities", "resources"] as const) {
    for (const item of snapshot[kind]) {
      const row = rowById.get(item.competency_row_id);
      if (!row) {
        error(
          "ORPHAN_ITEM",
          `${kind} item ${item.id} references unknown row ${item.competency_row_id}`,
          item.id,
        );
        continue;
      }
      if (!item.id.startsWith(`${row.id}:`))
        error(
          "INVALID_ID",
          `${kind} item id "${item.id}" does not belong to row ${row.id}`,
          item.id,
        );
      if (
        item.normalizations.includes("SUPERSCRIPT_UNMAPPED") &&
        !item.normalizations.includes("REVIEWED_OVERRIDE")
      ) {
        error(
          "UNREVIEWED_TEXT",
          `${kind} item ${item.id} contains unmapped superscript text that no person has reviewed`,
          item.id,
        );
      }
      const sub = subtopicById.get(row.subtopic_id);
      const topic = sub ? topicById.get(sub.topic_id) : undefined;
      checkSource(item.source, kind, item.id, topic ? topicSpan.get(topic.id) : undefined);
    }
    // ordinals contiguous per row
    const byRow = new Map<string, number[]>();
    for (const item of snapshot[kind])
      byRow.set(item.competency_row_id, [
        ...(byRow.get(item.competency_row_id) ?? []),
        item.ordinal,
      ]);
    for (const [rowKey, ordinals] of byRow) checkOrdinals(ordinals, `${kind} of ${rowKey}`, rowKey);
  }

  // ── assessment model (cross-checked again here so a hand-edited snapshot cannot slip through) ──
  const a = snapshot.assessment;
  const weightSum = a.components.reduce((sum, c) => sum + c.weighting_percent, 0);
  if (a.components.length > 0 && weightSum !== 100)
    error("ASSESSMENT_WEIGHTS", `Assessment component weightings add up to ${weightSum}, not 100`);
  for (const paperNumber of new Set(a.skill_bands.map((b) => b.paper_number))) {
    const total = a.skill_bands
      .filter((b) => b.paper_number === paperNumber)
      .reduce((s, b) => s + b.percent, 0);
    if (total !== 100)
      error(
        "ASSESSMENT_SKILLS",
        `Specification grid for paper ${paperNumber} adds up to ${total}%, not 100%`,
      );
  }
  const summative = a.components.find((c) => c.id === "SA");
  if (summative && a.papers.length > 0) {
    const paperTotal = a.papers.reduce((s, p) => s + p.paper_weighting_percent, 0);
    if (paperTotal !== summative.weighting_percent)
      error(
        "ASSESSMENT_WEIGHTS",
        `Paper weightings add up to ${paperTotal}%, not the summative ${summative.weighting_percent}%`,
      );
  }
  if (a.components.length === 0 || a.papers.length === 0 || a.skill_bands.length === 0)
    error("MISSING_ASSESSMENT", "The assessment model is incomplete");
  for (const c of a.components) checkSource(c.source, "assessment component", c.id);
  for (const p of a.papers) checkSource(p.source, "assessment paper", p.id);

  // ── pass-through of source warnings a person should see ───────────────────────────────────
  for (const w of snapshot.warnings) {
    if (w.code === "SOURCE_TYPO_SUSPECTED") warn(w.code, w.message, w.ref ?? undefined);
  }

  return issues;

  function checkOrdinals(ordinals: number[], what: string, ref: string) {
    const sorted = [...ordinals].sort((a, b) => a - b);
    for (let i = 0; i < sorted.length; i++) {
      if (sorted[i] !== i + 1) {
        error(
          "ORDINAL_GAP",
          `${what}: ordinals are not 1..${sorted.length} (found ${sorted.join(",")})`,
          ref,
        );
        return; // report once per list
      }
    }
  }
}

export function formatIssues(issues: ValidationIssue[]): string {
  return issues
    .map((i) => `  ${i.severity === "error" ? "ERROR  " : "warning"} [${i.code}] ${i.message}`)
    .join("\n");
}

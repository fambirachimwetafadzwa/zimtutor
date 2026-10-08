import type { SupabaseClient } from "@supabase/supabase-js";
import { getObjectiveDetail } from "../curriculum/queries";
import {
  OBJECTIVE_CONTEXT_COLUMNS,
  objectiveFromContextRow,
  type ObjectiveContextRow,
} from "../questions/objectives";
import type { ObjectiveInfo } from "../questions/types";
import type { ObjectiveFacts } from "./moves";
import type { CurriculumPort } from "./service";

/**
 * The syllabus for the tutor, read from the database. Retired objectives (no longer in the syllabus)
 * are not offered. The words in `content` and `activities` are the syllabus's own, row by row.
 */
export class SupabaseCurriculumPort implements CurriculumPort {
  constructor(private readonly db: SupabaseClient) {}

  async objective(id: string): Promise<ObjectiveInfo | null> {
    const { data, error } = await this.db
      .from("v_objective_context")
      .select(OBJECTIVE_CONTEXT_COLUMNS)
      .eq("objective_id", id)
      .is("retired_at", null)
      .maybeSingle();
    if (error) throw new Error(`Could not read the goal ${id}: ${error.message}`);
    return data ? objectiveFromContextRow(data as ObjectiveContextRow) : null;
  }

  async facts(id: string): Promise<ObjectiveFacts | null> {
    const detail = await getObjectiveDetail(this.db, id);
    if (!detail || detail.context.retired_at) return null;
    const { context, row } = detail;
    return {
      id: context.objective_id,
      text: context.objective_text,
      grade: context.grade,
      topicName: context.topic_name,
      subtopicName: context.subtopic_short_name,
      content: row.curriculum_content.map((item) => item.text),
      activities: row.curriculum_activities.map((item) => item.text),
      source: {
        title: context.source_title,
        page: context.source_page,
        pageLabel: context.source_page_label,
      },
    };
  }
}

/**
 * Fill the question bank with practice questions made from the templates.
 *
 *   npm run questions:seed                          2 questions per objective and level, all grades
 *   npm run questions:seed -- --per-level=5         more
 *   npm run questions:seed -- --grade=4             one grade
 *   npm run questions:seed -- --objective=G4-MEA-AREA-002
 *
 * Every question is checked before it is stored (it must mark its own answer right and each predicted
 * wrong answer wrong), is stored once whatever the number of runs, and is labelled as supplemental,
 * unverified practice: never as official. Reads DATABASE_URL.
 */
import { toBankInsert } from "../src/lib/questions/bank-rows";
import { generateQuestion } from "../src/lib/questions/generate";
import {
  objectiveFromContextRow,
  OBJECTIVE_CONTEXT_COLUMNS,
  type ObjectiveContextRow,
} from "../src/lib/questions/objectives";
import { ALL_TEMPLATES } from "../src/lib/questions/templates";
import type { Difficulty } from "../src/lib/questions/types";
import { connectFromEnv, parseArgs } from "./lib/connect";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const perLevel = Number(args.value("per-level") ?? 2);
  const grade = args.value("grade") ? Number(args.value("grade")) : null;
  const only = typeof args.value("objective") === "string" ? String(args.value("objective")) : null;
  const sql = connectFromEnv();
  try {
    const rows = await sql.unsafe<ObjectiveContextRow[]>(
      `select ${OBJECTIVE_CONTEXT_COLUMNS} from public.v_objective_context where retired_at is null order by objective_id`,
    );
    const objectives = rows
      .map(objectiveFromContextRow)
      .filter((o) => (grade === null || o.grade === grade) && (only === null || o.id === only));
    if (objectives.length === 0) throw new Error("No objective matches. Is the curriculum loaded?");

    let requested = 0;
    let withoutTemplate = 0;
    for (const objective of objectives) {
      if (!ALL_TEMPLATES.some((t) => t.covers(objective))) {
        withoutTemplate++;
        continue;
      }
      for (const difficulty of [1, 2, 3, 4, 5] as Difficulty[]) {
        for (let i = 0; i < perLevel; i++) {
          const question = generateQuestion({
            objective,
            difficulty,
            seed: `seed|${i}`,
            templates: ALL_TEMPLATES,
          });
          const { question: q, key } = toBankInsert(question);
          await sql`select public.bank_save_question(${sql.json(q as never)}, ${sql.json(key as never)})`;
          requested++;
        }
      }
    }
    const [counted] = await sql<Array<{ total: number }>>`
      select count(*)::int as total from public.questions`;
    console.log(
      `Saved ${requested} questions for ${objectives.length - withoutTemplate} objectives (${withoutTemplate} have no template). The bank now holds ${counted?.total ?? 0} questions.`,
    );
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

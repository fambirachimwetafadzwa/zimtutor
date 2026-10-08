/**
 * Print sample generated questions, for reading by eye.
 *
 *   npm run questions:sample -- G5-NUM-WHOLE-NUMBERS-006              one objective, all difficulties
 *   npm run questions:sample -- --template num.round-whole --grade 5   one template
 *   npm run questions:sample -- --seed abc --difficulty 3 --count 4
 */
import { readFileSync } from "node:fs";
import { snapshotSchema } from "../src/ingestion/snapshot";
import { generateQuestion } from "../src/lib/questions/generate";
import { objectivesFromSnapshot } from "../src/lib/questions/objectives";
import { ALL_TEMPLATES } from "../src/lib/questions/templates";
import type { Difficulty } from "../src/lib/questions/types";
import { parseArgs } from "./lib/connect";

const args = parseArgs(process.argv.slice(2));
const strFlag = (name: string): string | undefined => {
  const value = args.value(name);
  return typeof value === "string" ? value : undefined;
};
const snapshot = snapshotSchema.parse(
  JSON.parse(readFileSync("curriculum/snapshots/mopse-junior-mathematics-2024-2030.json", "utf8")),
);
const objectives = objectivesFromSnapshot(snapshot);

const templateId = strFlag("template");
const grade = strFlag("grade") ? Number(strFlag("grade")) : undefined;
const count = Number(strFlag("count") ?? 1);
const seed = strFlag("seed") ?? "sample";
const onlyDifficulty = strFlag("difficulty") ? (Number(strFlag("difficulty")) as Difficulty) : null;

let chosen = args.positional.length
  ? objectives.filter((o) => args.positional.includes(o.id))
  : objectives;
if (grade) chosen = chosen.filter((o) => o.grade === grade);
if (templateId) {
  const template = ALL_TEMPLATES.find((t) => t.id === templateId);
  if (!template) throw new Error(`No template ${templateId}`);
  chosen = chosen.filter((o) => template.covers(o));
}

for (const objective of chosen.slice(0, args.positional.length ? 100 : 6)) {
  console.log(`\n══ ${objective.id}: ${objective.text}`);
  for (const difficulty of onlyDifficulty ? [onlyDifficulty] : ([1, 2, 3, 4, 5] as const)) {
    for (let i = 0; i < count; i++) {
      try {
        const q = generateQuestion({
          objective,
          difficulty,
          seed: `${seed}${i}`,
          templates: ALL_TEMPLATES,
          ...(templateId ? { templateId } : {}),
        });
        console.log(`\n[d${difficulty}] ${q.templateId} ${q.type} (${q.assessmentSkill})`);
        console.log(q.stem);
        if (q.stemData) console.log("  picture:", JSON.stringify(q.stemData));
        if (q.options) for (const o of q.options) console.log(`   ${o.id}) ${o.text}`);
        if (q.items) console.log("   items:", q.items.join(" | "));
        if (q.matching)
          console.log("   match:", q.matching.left.join(" | "), "→", q.matching.right.join(" | "));
        if (q.answerFields)
          console.log("   fields:", q.answerFields.map((f) => f.label).join(" | "));
        if (q.answerHint) console.log("   (", q.answerHint, ")");
        console.log(
          "   answer:",
          JSON.stringify(q.correctAnswer),
          "  tags:",
          q.misconceptionTags.join(",") || "-",
        );
        q.hints.forEach((h, k) => console.log(`   hint ${k + 1}: ${h}`));
        console.log("   why:", q.explanation);
      } catch (error) {
        console.log(`\n[d${difficulty}] ✗ ${error instanceof Error ? error.message : error}`);
      }
    }
  }
}

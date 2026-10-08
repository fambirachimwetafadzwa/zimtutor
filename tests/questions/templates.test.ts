import { describe, expect, it } from "vitest";
import { generateQuestion } from "../../src/lib/questions/generate";
import { ALL_TEMPLATES } from "../../src/lib/questions/templates";
import { verifyQuestion } from "../../src/lib/questions/verify";
import { DIFFICULTIES, OBJECTIVES } from "./support";

/**
 * Every template is run against every objective it claims to cover, at every difficulty, with many
 * seeds. A template that cannot produce a valid, self-consistent question for any of those is a bug
 * that would otherwise only show up when a child reaches that objective.
 */

const SEEDS = 6;

describe.each(ALL_TEMPLATES.map((t) => [t.id, t] as const))("template %s", (_id, template) => {
  const covered = OBJECTIVES.filter((o) => template.covers(o));

  it("covers at least one objective", () => {
    expect(covered.length).toBeGreaterThan(0);
  });

  it("generates valid, verified, deterministic questions for every objective and difficulty", () => {
    const failures: string[] = [];
    for (const objective of covered) {
      for (const difficulty of DIFFICULTIES) {
        if (template.levels && !template.levels.includes(difficulty)) continue;
        const hashes = new Set<string>();
        for (let i = 0; i < SEEDS; i++) {
          const params = {
            objective,
            difficulty,
            seed: `harness-${i}`,
            templates: ALL_TEMPLATES,
            templateId: template.id,
          };
          try {
            const q = generateQuestion(params);
            hashes.add(q.contentHash);
            // verified at generation, and again here from the outside
            const problems = verifyQuestion(q);
            if (problems.length > 0)
              failures.push(`${objective.id} d${difficulty} #${i}: ${problems[0]!.detail}`);
            const text = [
              q.stem,
              ...(q.options?.map((o) => o.text) ?? []),
              ...(q.items ?? []),
              ...(q.matching ? [...q.matching.left, ...q.matching.right] : []),
              ...q.hints,
              q.explanation,
              ...(q.stemData ? [JSON.stringify(q.stemData)] : []),
            ].join(" ");
            if (/undefined|NaN|Infinity|\[object|\bnull\b/.test(text))
              failures.push(
                `${objective.id} d${difficulty} #${i}: broken text ${text.slice(0, 160)}`,
              );
            if (i === 0) {
              const again = generateQuestion(params);
              if (JSON.stringify(again) !== JSON.stringify(q))
                failures.push(`${objective.id} d${difficulty}: not deterministic`);
            }
          } catch (error) {
            failures.push(
              `${objective.id} d${difficulty} #${i}: ${error instanceof Error ? error.message.split("\n").slice(0, 2).join(" | ") : error}`,
            );
          }
        }
        if (hashes.size < 2)
          failures.push(
            `${objective.id} d${difficulty}: only ${hashes.size} distinct question(s) in ${SEEDS} seeds`,
          );
      }
    }
    expect(failures.slice(0, 15), `${failures.length} failure(s)`).toEqual([]);
  });
});

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Picture } from "../../src/components/learn/pictures";
import { labelBox, placeLabels } from "../../src/components/learn/pictures/measures";
import { findLeak } from "../../src/lib/questions/verify";
import { generateQuestion } from "../../src/lib/questions/generate";
import { ALL_TEMPLATES } from "../../src/lib/questions/templates";
import { answerFormsFrom } from "../../src/lib/questions/verify";
import type { StemData } from "../../src/lib/questions/types";
import { OBJECTIVES } from "../questions/support";

/**
 * Every picture the templates can make is drawn without error, stays inside its frame, has no broken
 * numbers, and describes itself without giving away the answer.
 */

interface Sample {
  data: StemData;
  forms: string[];
  where: string;
}

function samples(): Sample[] {
  const out = new Map<string, Sample>();
  for (const objective of OBJECTIVES) {
    for (const difficulty of [1, 2, 3, 4, 5] as const) {
      for (const seed of ["pic-a", "pic-b", "pic-c"]) {
        let q;
        try {
          q = generateQuestion({ objective, difficulty, seed, templates: ALL_TEMPLATES });
        } catch {
          break;
        }
        if (!q.stemData) continue;
        const key = JSON.stringify(q.stemData);
        if (!out.has(key))
          out.set(key, {
            data: q.stemData,
            forms: answerFormsFrom({
              marking: q.marking,
              correctAnswer: q.correctAnswer,
              options: q.options,
            }),
            where: `${q.templateId} (${objective.id}, level ${difficulty})`,
          });
      }
    }
  }
  return [...out.values()];
}

const markup = (data: StemData) => renderToStaticMarkup(createElement(Picture, { data }));

const NUMERIC_ATTRS = ["x", "y", "cx", "cy", "x1", "y1", "x2", "y2"] as const;

function boundsProblems(html: string): string[] {
  const view = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(html);
  if (!view) return [];
  const W = Number(view[1]);
  const H = Number(view[2]);
  const problems: string[] = [];
  for (const tag of html.matchAll(/<(rect|circle|line|text|polygon|polyline)\b([^>]*)>/g)) {
    const attrs = tag[2]!;
    const num = (name: string) => {
      const m = new RegExp(`(?:^|\\s)${name}="(-?[\\d.]+)"`).exec(attrs);
      return m ? Number(m[1]) : undefined;
    };
    for (const name of NUMERIC_ATTRS) {
      const v = num(name);
      if (v === undefined) continue;
      const limit = name.includes("x") ? W : H;
      if (v < -3 || v > limit + 3) problems.push(`<${tag[1]} ${name}=${v}> outside 0..${limit}`);
    }
    const x = num("x");
    const w = num("width");
    const y = num("y");
    const h = num("height");
    if (tag[1] === "rect" && x !== undefined && w !== undefined && x + w > W + 3)
      problems.push(`<rect> runs past the right edge (${x + w} > ${W})`);
    if (tag[1] === "rect" && y !== undefined && h !== undefined && y + h > H + 3)
      problems.push(`<rect> runs past the bottom edge (${y + h} > ${H})`);
    const points = /points="([^"]+)"/.exec(attrs);
    if (points)
      for (const pair of points[1]!.split(" ")) {
        const [px, py] = pair.split(",").map(Number);
        if (px! < -3 || px! > W + 3 || py! < -3 || py! > H + 3)
          problems.push(`<${tag[1]}> has a point (${pair}) outside the frame`);
      }
  }
  return problems;
}

describe("question pictures", () => {
  const all = samples();

  it("covers every kind of picture the templates make", () => {
    const kinds = new Set(all.map((s) => s.data.kind));
    expect([...kinds].sort()).toEqual(
      [
        "angle",
        "angle-sum",
        "bar-chart",
        "circle-part",
        "clock",
        "compass",
        "cuboid",
        "dial-scale",
        "fraction-bar",
        "grid",
        "jug",
        "l-shape",
        "line",
        "line-graph",
        "map",
        "number-line",
        "pictograph",
        "pie-chart",
        "polygon",
        "rectangle",
        "ruler",
        "table",
        "tally",
        "triangle",
      ].sort(),
    );
    expect(all.length).toBeGreaterThan(100);
  });

  it("draws every one of them with finite numbers inside the frame", () => {
    const problems: string[] = [];
    for (const { data, where } of all) {
      const html = markup(data);
      if (html.length < 40) problems.push(`${where}: nothing was drawn`);
      if (/NaN|undefined|Infinity|\bnull\b/.test(html))
        problems.push(`${where} (${data.kind}): broken value in the drawing`);
      for (const p of boundsProblems(html)) problems.push(`${where} (${data.kind}): ${p}`);
    }
    expect(problems.slice(0, 12), `${problems.length} problem(s)`).toEqual([]);
  });

  it("describes every picture, and the description never gives the answer", () => {
    const leaks: string[] = [];
    for (const { data, forms: allForms, where } of all) {
      const html = markup(data);
      const isSvg = html.startsWith("<svg");
      if (isSvg && !/role="img"/.test(html)) leaks.push(`${where}: an SVG without a description`);
      const rawLabel = (/aria-label="([^"]*)"/.exec(html)?.[1] ?? "").replaceAll("&#x27;", "'");
      // a chart's title and a table's caption are printed on the picture itself, so they are not a leak;
      // and "north at the top" is the map's convention, which the question needs the learner to know
      const printed = "title" in data ? data.title : "caption" in data ? (data.caption ?? "") : "";
      const label = printed ? rawLabel.replace(printed, "") : rawLabel;
      // a pictograph's description is its visible content, key included: reading the key is a question
      if (data.kind === "pictograph") continue;
      const forms =
        data.kind === "map" ? allForms.filter((f) => f.toLowerCase() !== "north") : allForms;
      if (isSvg && label.length < 6) leaks.push(`${where}: description too short ("${label}")`);
      // what the picture says about itself must not contain the answer to its own question
      // (a chart's data list is part of the question, so only the label is checked)
      const hit = findLeak(label, forms);
      if (hit !== null)
        leaks.push(
          `${where} (${data.kind}): the description "${label}" contains the answer "${hit}"`,
        );
    }
    expect(leaks.slice(0, 12), `${leaks.length} problem(s)`).toEqual([]);
  });

  it("writes the names on a map where they cannot be mistaken for each other", () => {
    const maps = all
      .map((a) => a.data)
      .filter((d): d is Extract<StemData, { kind: "map" }> => d.kind === "map");
    expect(maps.length).toBeGreaterThan(5);
    const problems: string[] = [];
    for (const map of maps) {
      const cell = 46;
      const pad = 40;
      const W = pad * 2 + (map.cols - 1) * cell + 36;
      const H = pad * 2 + (map.rows - 1) * cell;
      const dots = map.places.map((p) => ({
        x: pad + p.col * cell,
        y: pad + p.row * cell,
        label: p.label,
      }));
      const spots = placeLabels(dots, { width: W, height: H });
      const boxes = spots.map((c) => labelBox(c));
      const hit = (a: readonly number[], b: readonly number[]) =>
        a[0]! < b[2]! && a[2]! > b[0]! && a[1]! < b[3]! && a[3]! > b[1]!;
      boxes.forEach((a, i) => {
        boxes.forEach((b, j) => {
          if (j > i && hit(a, b)) problems.push(`${dots[i]!.label} and ${dots[j]!.label} overlap`);
        });
        dots.forEach((d, j) => {
          if (j !== i && hit(a, [d.x - 7, d.y - 7, d.x + 7, d.y + 7]))
            problems.push(`${dots[i]!.label} covers the dot of ${d.label}`);
        });
      });
    }
    expect(problems).toEqual([]);
  });

  it("draws pictures that depend on the data in a way that shows", () => {
    const clock = (hour: number, minute: number) => markup({ kind: "clock", hour, minute });
    expect(clock(3, 0)).not.toBe(clock(4, 0));
    expect(clock(3, 0)).not.toBe(clock(3, 30));
    const grid = (shaded: number) => markup({ kind: "grid", rows: 2, cols: 5, shaded });
    expect(grid(3).match(/fill-brand stroke-foreground/g)).toHaveLength(3);
    expect(grid(10).match(/fill-brand stroke-foreground/g)).toHaveLength(10);
    const bars = (orientation?: "vertical" | "horizontal") =>
      markup({
        kind: "bar-chart",
        title: "T",
        xLabel: "Day",
        yLabel: "Count",
        bars: [
          { label: "Mon", value: 3 },
          { label: "Tue", value: 6 },
        ],
        max: 10,
        step: 2,
        ...(orientation ? { orientation } : {}),
      });
    expect(bars("horizontal")).not.toBe(bars("vertical"));
    expect(bars()).toBe(bars("vertical"));
  });
});

import { aOrAn } from "../context";
import {
  byLevel,
  defineTemplate,
  fmtDecimal,
  fmtInt,
  scoped,
  type Builders,
  type Wrong,
} from "../kit";
import { trimmedDecimal } from "../maths";
import type { AssessmentSkill, QuestionType, StemData } from "../types";

/**
 * Shapes, symmetry, parts of a circle, perimeter and area. Shapes follow the printed Content:
 * square, rectangle, triangle (G3, G4) · kite and pentagon (G5) · polygons up to 10 sides (G6, G7).
 */

const MEA = "MEA" as const;

interface Measure {
  skill: AssessmentSkill;
  type?: Extract<QuestionType, "NUMERIC" | "WORD_PROBLEM" | "VISUAL_DIAGRAM">;
  stem: string;
  stemData?: StemData;
  value: number;
  unit: string;
  wrongs: Array<{ value: number; tag?: string }>;
  explanation: string;
  hints: string[];
  local?: boolean;
}

/** A measurement answer, e.g. a perimeter in cm or an area in m². */
function measure(q: Builders, m: Measure) {
  const text = (n: number) => trimmedDecimal(Math.round(n * 100), 2);
  const wrongs: Wrong[] = m.wrongs
    .filter((w) => w.value !== m.value && w.value > 0)
    .map((w) => ({ answer: text(w.value), ...(w.tag ? { tag: w.tag } : {}) }));
  return q.unit({
    skill: m.skill,
    type: m.type ?? "NUMERIC",
    stem: m.stem,
    ...(m.stemData ? { stemData: m.stemData } : {}),
    value: text(m.value),
    unit: m.unit,
    unitOptional: true,
    strictUnit: false,
    answerText: `${fmtDecimal(text(m.value))} ${m.unit}`,
    wrongs,
    explanation: m.explanation,
    hints: m.hints,
    usesLocalContext: m.local ?? false,
  });
}

interface Bank {
  stem: string;
  correct: string;
  wrongs: string[];
  /** Accepted typed answers. */
  typed?: string[];
  stemData?: StemData;
  explanation: string;
  hints: string[];
}

// ── naming polygons ─────────────────────────────────────────────────────────────────────────────

const POLYGON_NAMES: Record<number, string> = {
  3: "triangle",
  4: "quadrilateral",
  5: "pentagon",
  6: "hexagon",
  7: "heptagon",
  8: "octagon",
  9: "nonagon",
  10: "decagon",
};
const POLYGON_PREFIX: Record<number, string> = {
  3: "tri",
  4: "quad",
  5: "penta",
  6: "hexa",
  7: "hepta",
  8: "octa",
  9: "nona",
  10: "deca",
};

export const polygonNames = defineTemplate({
  id: "mea.polygon-names",
  description: "Name polygons and count their sides (up to 4, 5 or 10 sides, by grade).",
  covers: (o) =>
    scoped(o, {
      topic: MEA,
      strand: /^shapes/,
      text: /name polygons/i,
    }),
  generate: ({ objective: o, difficulty: d, rng, q }) => {
    // Only polygons within the grade's limit are named (Grade 3: up to 4 sides, Grade 5: up to 5, Grade 6: up to 10).
    const maxSides = o.grade <= 4 ? 4 : o.grade === 5 ? 5 : 10;
    const sides = rng.int(3, maxSides);
    const name = POLYGON_NAMES[sides]!;
    const prefix = POLYGON_PREFIX[sides]!;
    // The closest names make the best wrong choices. A circle has no straight sides, so it is never
    // a polygon: a safe extra choice for the smaller grades.
    const others = [
      ...Object.entries(POLYGON_NAMES)
        .map(([k, v]) => ({ sides: Number(k), name: v }))
        .filter((e) => e.sides <= maxSides && e.sides !== sides)
        .sort((a, b) => Math.abs(a.sides - sides) - Math.abs(b.sides - sides) || a.sides - b.sides)
        .map((e) => e.name),
      "circle",
    ];
    const wrongNames = rng.sample(others.slice(0, 4), 3).map((answer) => ({ answer }));
    const mode = d <= 2 ? "picture" : rng.pick(["picture", "count", "describe"] as const);
    if (mode === "count") {
      // Squares and rectangles also have four sides.
      const shape = sides === 4 ? rng.pick(["quadrilateral", "square", "rectangle"]) : name;
      return q.numeric({
        skill: "KNOWLEDGE_COMPREHENSION",
        stem: `How many sides does a ${shape} have?`,
        answer: String(sides),
        wrongs: [
          { answer: String(sides + 1) },
          { answer: String(sides - 1) },
          { answer: String(sides * 2) },
        ].filter((w) => Number(w.answer) > 0),
        explanation: `A ${shape} is a polygon with ${sides} sides.${shape === name ? ` The first part of its name, "${prefix}-", tells how many.` : ""}`,
        hints: [
          "A polygon is a flat shape with straight sides.",
          `Picture a ${shape} (or draw it) and count its sides one by one.`,
        ],
      });
    }
    if (mode === "describe") {
      return q.mcq({
        skill: "KNOWLEDGE_COMPREHENSION",
        stem: `What do we call a polygon with ${sides} sides?`,
        correct: name,
        wrongs: wrongNames,
        explanation: `A polygon with ${sides} sides is called a ${name}: "${prefix}-" means ${sides}.`,
        hints: [
          "The name of a polygon comes from the number of its sides.",
          `The part at the start of the name tells the number. For ${sides} sides it is "${prefix}-".`,
        ],
      });
    }
    // a picture of a regular polygon
    const picture: StemData = { kind: "polygon", sides, regular: true };
    const shown = sides === 4 ? "square" : name;
    return q.mcq({
      skill: "KNOWLEDGE_COMPREHENSION",
      type: "VISUAL_DIAGRAM",
      stem: "What is the name of this polygon?",
      stemData: picture,
      correct: shown,
      wrongs: wrongNames,
      explanation:
        sides === 4
          ? "The shape has 4 equal sides and 4 square corners, so it is a square (a kind of quadrilateral)."
          : `The shape has ${sides} sides, so it is a ${name}.`,
      hints: [
        "Count the straight sides of the shape.",
        "The name of a polygon comes from its number of sides.",
      ],
    });
  },
});

// ── knowledge banks: classifying and describing shapes ──────────────────────────────────────────

type Dim = "plane" | "solid" | "both";
interface ShapeItem extends Bank {
  dim: Dim;
}

const item = (
  dim: Dim,
  stem: string,
  correct: string,
  wrongs: string[],
  explanation: string,
  hints: string[],
  typed?: string[],
): ShapeItem => ({ dim, stem, correct, wrongs, explanation, hints, ...(typed ? { typed } : {}) });

function shapeBank(grade: number, kind: "classify" | "name" | "properties"): ShapeItem[] {
  const out: ShapeItem[] = [];
  if (kind === "classify") {
    out.push(
      item(
        "both",
        "Which of these is a solid (3-dimensional) shape?",
        "cylinder",
        ["square", "circle", "triangle"],
        "A solid shape takes up space: you can hold it. A cylinder is a solid shape; a square, circle and triangle are flat (plane) shapes.",
        [
          "A solid shape is not flat: you can hold it in your hand.",
          "Plane shapes are flat shapes you can draw on paper.",
        ],
      ),
      item(
        "both",
        "Which of these is a plane (flat, 2-dimensional) shape?",
        "rectangle",
        ["cube", "sphere", "cone"],
        "A plane shape is flat. A rectangle is a plane shape; a cube, sphere and cone are solid shapes.",
        [
          "A plane shape is flat, like a shape drawn on paper.",
          "Solid shapes can be held and have thickness.",
        ],
      ),
      item(
        "both",
        "Which of these is a solid shape?",
        "sphere",
        ["triangle", "square", "rectangle"],
        "A sphere (like a ball) is a solid shape.",
        ["A solid shape can be held in the hand.", "Which one is shaped like a ball?"],
      ),
      item(
        "both",
        "Which of these is a plane shape?",
        "circle",
        ["cylinder", "cone", "cube"],
        "A circle is flat, so it is a plane shape.",
        ["A plane shape is flat.", "Which shape is flat, like a coin drawn on paper?"],
      ),
      item(
        "both",
        "Which of these shapes is NOT a solid shape?",
        "triangle",
        ["cube", "cone", "cylinder"],
        "A triangle is flat, so it is a plane shape. The cube, cone and cylinder are solid shapes.",
        [
          "Solid shapes can be held and take up space.",
          "Three of the shapes are solid; one is flat.",
        ],
      ),
      item(
        "both",
        "A ball is a … shape.",
        "solid",
        ["plane", "flat", "drawn"],
        "A ball takes up space and can be held, so it is a solid shape.",
        ["Can you hold a ball in your hand?", "Plane shapes are flat; solid shapes are not."],
        ["solid", "3-dimensional", "3d", "three dimensional", "3 dimensional"],
      ),
    );
  }
  if (kind === "name") {
    out.push(
      item(
        "solid",
        "A football has the shape of a …",
        "sphere",
        ["cone", "cube", "cylinder"],
        "A ball has the shape of a sphere.",
        [
          "Think of a shape that is round all the way round.",
          "It has no flat faces and no corners.",
        ],
        ["sphere"],
      ),
      item(
        "solid",
        "A tin of beans has the shape of a …",
        "cylinder",
        ["sphere", "cone", "cube"],
        "A tin has two flat round ends joined by a curved side: that is a cylinder.",
        [
          "Look at the top and the bottom of a tin: what shape are they?",
          "It has two flat round faces and one curved surface.",
        ],
        ["cylinder"],
      ),
      item(
        "solid",
        "A dice (die) has the shape of a …",
        "cube",
        ["cylinder", "cone", "sphere"],
        "A dice has 6 equal square faces: that is a cube.",
        ["A dice has the same flat shape on every face.", "Every face is a square."],
        ["cube"],
      ),
      item(
        "solid",
        "A party hat has the shape of a …",
        "cone",
        ["cube", "cylinder", "sphere"],
        "A cone has one flat round face and comes to a point.",
        ["It has one round end and comes to a point at the other end."],
        ["cone"],
      ),
      item(
        "solid",
        "A matchbox has the shape of a …",
        "rectangular prism",
        ["cone", "sphere", "cylinder"],
        "A matchbox has 6 rectangular faces: it is a rectangular prism (also called a cuboid).",
        ["All its faces are rectangles.", "It looks like a box."],
        ["rectangular prism", "cuboid"],
      ),
      item(
        "plane",
        "The top of a tin is a … shape.",
        "circle",
        ["square", "triangle", "rectangle"],
        "The flat top of a tin is round: it is a circle.",
        ["Look at the flat top of a tin.", "It has no corners and no straight sides."],
        ["circle"],
      ),
      item(
        "plane",
        "A page of your exercise book has the shape of a …",
        "rectangle",
        ["circle", "triangle", "square"],
        "A page has four straight sides and four square corners, with opposite sides equal: it is a rectangle.",
        [
          "Count the sides and the corners of a page.",
          "Is it a square, or is it longer than it is wide?",
        ],
        ["rectangle"],
      ),
      item(
        "plane",
        "Each face of a dice has the shape of a …",
        "square",
        ["circle", "triangle", "rectangle"],
        "Each face of a dice has 4 equal sides and 4 square corners: it is a square.",
        ["Count the sides of one face.", "Are the sides all the same length?"],
        ["square"],
      ),
      item(
        "plane",
        "A set square (used for drawing) has the shape of a …",
        "triangle",
        ["circle", "square", "rectangle"],
        "A set square has three sides and three corners: it is a triangle.",
        ["Count its sides.", "A shape with 3 sides is called a …"],
        ["triangle", "right angled triangle", "right-angled triangle"],
      ),
      item(
        "plane",
        "A window pane in the shape of a rectangle is a … shape.",
        "plane",
        ["solid", "sphere", "cone"],
        "A rectangle is flat, so it is a plane shape.",
        ["Is a rectangle flat, or can you hold it?", "Solid shapes have thickness."],
        ["plane", "flat", "2-dimensional", "two dimensional", "2 dimensional"],
      ),
    );
    if (grade >= 5)
      out.push(
        item(
          "plane",
          "A flat shape with 5 straight sides is called a …",
          "pentagon",
          ["triangle", "square", "kite"],
          "A pentagon has 5 straight sides.",
          ["The prefix penta- means five."],
          ["pentagon"],
        ),
        item(
          "plane",
          "A flat shape with 4 sides, in which two pairs of equal sides are next to each other, is called a …",
          "kite",
          ["pentagon", "triangle", "circle"],
          "A kite has 4 sides: two short sides next to each other and two long sides next to each other.",
          ["Think of the shape of a kite flying in the sky."],
          ["kite"],
        ),
      );
  }
  if (kind === "properties") {
    out.push(
      item(
        "solid",
        "How many faces does a cube have?",
        "6",
        ["4", "8", "12"],
        "A cube has 6 square faces.",
        [
          "Think of a dice: count the sides that show the spots.",
          "There is a top, a bottom and four sides.",
        ],
        ["6", "six"],
      ),
      item(
        "solid",
        "How many edges does a cube have?",
        "12",
        ["6", "8", "10"],
        "A cube has 12 edges: 4 on the top, 4 on the bottom and 4 going up.",
        [
          "Edges are where two faces meet.",
          "Count 4 on the top, 4 on the bottom and 4 joining them.",
        ],
        ["12", "twelve"],
      ),
      item(
        "solid",
        "How many corners (vertices) does a cube have?",
        "8",
        ["4", "6", "12"],
        "A cube has 8 corners: 4 on the top and 4 on the bottom.",
        ["Count the corners on the top, then on the bottom."],
        ["8", "eight"],
      ),
      item(
        "solid",
        "How many flat faces does a cylinder have?",
        "2",
        ["1", "3", "0"],
        "A cylinder has 2 flat circular faces (the top and the bottom) and 1 curved surface.",
        ["Think of a tin: it has a flat top and a flat bottom."],
        ["2", "two"],
      ),
      item(
        "solid",
        "How many flat faces does a cone have?",
        "1",
        ["0", "2", "3"],
        "A cone has 1 flat circular face (its base) and 1 curved surface.",
        ["An ice-cream cone has an open round top. How many flat faces is that?"],
        ["1", "one"],
      ),
      item(
        "solid",
        "How many flat faces does a sphere have?",
        "0",
        ["1", "2", "6"],
        "A sphere is round all over: it has no flat faces.",
        ["Think of a ball: is any part of it flat?"],
        ["0", "none", "zero"],
      ),
      item(
        "solid",
        "Which solid shape has 6 faces that are all squares?",
        "cube",
        ["cylinder", "cone", "sphere"],
        "A cube has 6 square faces.",
        ["Think of a dice.", "Which solid shape has flat faces that are all the same?"],
        ["cube"],
      ),
      item(
        "solid",
        "Which solid shape has one flat face, one curved surface and a point at the top?",
        "cone",
        ["cylinder", "cube", "sphere"],
        "A cone has one flat circular face and a curved surface that comes to a point.",
        ["Think of an ice-cream cone.", "The shape comes to a point."],
        ["cone"],
      ),
      item(
        "plane",
        "How many sides does a rectangle have?",
        "4",
        ["3", "5", "6"],
        "A rectangle has 4 sides.",
        ["Count the straight sides of a book cover."],
        ["4", "four"],
      ),
      item(
        "plane",
        "How many right angles does a rectangle have?",
        "4",
        ["2", "3", "0"],
        "Every corner of a rectangle is a right angle, so it has 4 right angles.",
        ["A right angle is like the corner of a page. Look at each corner."],
        ["4", "four"],
      ),
      item(
        "plane",
        "How many equal sides does a square have?",
        "4",
        ["2", "3", "0"],
        "All 4 sides of a square are equal in length.",
        ["A square has sides that are all the same length."],
        ["4", "four"],
      ),
      item(
        "plane",
        "How many corners does a triangle have?",
        "3",
        ["4", "5", "2"],
        "A triangle has 3 sides and 3 corners.",
        ["Count the points where two sides meet."],
        ["3", "three"],
      ),
      item(
        "plane",
        "Which flat shape has no straight sides and no corners?",
        "circle",
        ["square", "triangle", "rectangle"],
        "A circle has one curved side and no corners.",
        ["Which flat shape is perfectly round?"],
        ["circle"],
      ),
      item(
        "plane",
        "How many right angles does a right-angled triangle have?",
        "1",
        ["2", "3", "0"],
        "A right-angled triangle has exactly one right angle.",
        ["The name tells you: right-angled."],
        ["1", "one"],
      ),
      item(
        "plane",
        "A shape has 4 sides. Opposite sides are equal, but the sides next to each other are different. All 4 corners are right angles. What shape is it?",
        "rectangle",
        ["square", "triangle", "circle"],
        "A shape with 4 right angles and opposite sides equal (but not all four sides equal) is a rectangle.",
        [
          "Think about shapes with 4 sides.",
          "In a square all four sides are equal. Here only the opposite sides are equal.",
        ],
        ["rectangle"],
      ),
    );
    if (grade >= 5)
      out.push(
        item(
          "plane",
          "How many sides does a pentagon have?",
          "5",
          ["4", "6", "8"],
          "A pentagon has 5 sides.",
          ["The prefix penta- means five."],
          ["5", "five"],
        ),
        item(
          "plane",
          "How many sides does a kite have?",
          "4",
          ["3", "5", "6"],
          "A kite has 4 sides: two pairs of equal sides next to each other.",
          ["A kite is a four-sided shape."],
          ["4", "four"],
        ),
        item(
          "solid",
          "How many faces does a rectangular prism have?",
          "6",
          ["4", "8", "12"],
          "A rectangular prism (cuboid) has 6 rectangular faces.",
          ["Count the top, the bottom and the four sides."],
          ["6", "six"],
        ),
        item(
          "solid",
          "How many edges does a rectangular prism have?",
          "12",
          ["6", "8", "10"],
          "A rectangular prism has 12 edges: 4 on the top, 4 on the bottom and 4 going up.",
          ["Count the edges on the top, on the bottom, and the ones joining them."],
          ["12", "twelve"],
        ),
      );
  }
  return out;
}

export const shapeKnowledge = defineTemplate({
  id: "mea.shape-knowledge",
  description: "Classify, name and describe plane and solid shapes.",
  covers: (o) =>
    scoped(o, {
      topic: MEA,
      strand: /^shapes/,
      text: /classify shapes|name different (?:plane|solid) shapes|name plane and solid|state properties|describe properties|list properties|identify 2 and 3 dimensional/i,
    }),
  generate: ({ objective: o, difficulty: d, rng, q }) => {
    const t = o.text.toLowerCase();
    const kind = /properties/.test(t) ? "properties" : /name/.test(t) ? "name" : "classify";
    // "name different plane shapes" asks for flat shapes only, "… solid shapes" for solids only.
    const only: Dim | null =
      /\bplane\b/.test(t) && !/\bsolid\b/.test(t)
        ? "plane"
        : /\bsolid\b/.test(t) && !/\bplane\b/.test(t)
          ? "solid"
          : null;
    const bank = shapeBank(o.grade, kind).filter(
      (i) => only === null || i.dim === "both" || i.dim === only,
    );
    const chosen = rng.pick(bank);
    if (chosen.typed && d >= 3)
      return q.text({
        skill: "KNOWLEDGE_COMPREHENSION",
        stem: chosen.stem,
        accepted: chosen.typed,
        answerHint: "Type your answer.",
        explanation: chosen.explanation,
        hints:
          chosen.hints.length >= 2
            ? chosen.hints
            : [...chosen.hints, "Picture the shape in your mind."],
      });
    return q.mcq({
      skill: "KNOWLEDGE_COMPREHENSION",
      stem: chosen.stem,
      correct: chosen.correct,
      wrongs: chosen.wrongs.map((answer) => ({ answer })),
      explanation: chosen.explanation,
      hints:
        chosen.hints.length >= 2
          ? chosen.hints
          : [...chosen.hints, "Cross out the choices that cannot be right."],
    });
  },
});

// ── shapes in patterns ──────────────────────────────────────────────────────────────────────────

export const shapePatterns = defineTemplate({
  id: "mea.shape-patterns",
  description: "Find the next shape (or a later shape) in a repeating pattern of shapes.",
  covers: (o) => scoped(o, { topic: MEA, strand: /^shapes/, text: /shapes in patterns/i }),
  generate: ({ difficulty: d, rng, q }) => {
    const pool = ["square", "rectangle", "triangle", "circle"];
    const length = d <= 2 ? 2 : 3;
    const core = rng.sample(pool, length);
    const shown = length * 2 + rng.int(0, length - 1);
    const sequence = Array.from({ length: shown }, (_, i) => core[i % length]!);
    const farther = d >= 4;
    const position = farther ? shown + rng.int(length + 1, length * 3) : shown + 1;
    const answer = core[(position - 1) % length]!;
    const ordinal = (n: number) =>
      `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th")}`;
    const wrongs = pool.filter((s) => s !== answer).map((s) => ({ answer: s }));
    const cycle = (position - 1) % length;
    return q.mcq({
      skill: farther ? "ANALYSIS" : "KNOWLEDGE_COMPREHENSION",
      stem: `A pattern is made with shapes: ${sequence.join(", ")}, … What will the ${ordinal(position)} shape in the pattern be?`,
      correct: answer,
      wrongs,
      explanation: farther
        ? `The pattern repeats every ${length} shapes: ${core.join(", ")}. ${position} ÷ ${length} leaves a remainder of ${position % length}, so the ${ordinal(position)} shape is ${position % length === 0 ? "the last shape of a complete repeat" : `the ${ordinal(cycle + 1)} shape of the repeating part`}: ${answer}.`
        : `The pattern repeats ${core.join(", ")}. After ${sequence[shown - 1]} comes ${answer}.`,
      hints: [
        "Find the part of the pattern that keeps repeating.",
        `The repeating part has ${length} shapes. Which shape comes after the last one shown?`,
        farther
          ? "Count how many complete repeats fit in the position you want, and see which shape is left over."
          : "Look at the shape that came after the last time the pattern started over.",
      ],
    });
  },
});

// ── symmetry ────────────────────────────────────────────────────────────────────────────────────

const SYMMETRY: Array<{ name: string; lines: number; picture?: StemData }> = [
  { name: "square", lines: 4, picture: { kind: "polygon", sides: 4, regular: true } },
  { name: "equilateral triangle", lines: 3, picture: { kind: "polygon", sides: 3, regular: true } },
  { name: "regular pentagon", lines: 5, picture: { kind: "polygon", sides: 5, regular: true } },
  { name: "regular hexagon", lines: 6, picture: { kind: "polygon", sides: 6, regular: true } },
  { name: "regular octagon", lines: 8, picture: { kind: "polygon", sides: 8, regular: true } },
  { name: "rectangle that is not a square", lines: 2 },
  {
    name: "rhombus that is not a square",
    lines: 2,
    picture: { kind: "polygon", sides: 4, regular: false, shape: "rhombus" },
  },
  { name: "kite", lines: 1, picture: { kind: "polygon", sides: 4, regular: false, shape: "kite" } },
  { name: "isosceles triangle", lines: 1 },
  {
    name: "parallelogram that is not a rectangle",
    lines: 0,
    picture: { kind: "polygon", sides: 4, regular: false, shape: "parallelogram" },
  },
];

export const symmetryLines = defineTemplate({
  id: "mea.symmetry",
  description: "Count the lines of symmetry of common shapes.",
  covers: (o) =>
    scoped(o, { topic: MEA, strand: /^shapes/, text: /lines of symmetry/i, not: /draw/i }),
  generate: ({ difficulty: d, rng, q }) => {
    const easy = SYMMETRY.filter((s) => (d <= 2 ? s.lines <= 4 : true));
    const shape = rng.pick(easy);
    const wrongs = [shape.lines + 1, shape.lines + 2, Math.max(0, shape.lines - 1), shape.lines * 2]
      .filter((n) => n !== shape.lines)
      .map((n) => ({ answer: String(n) }));
    const common = {
      skill: "ANALYSIS" as const,
      stem: shape.picture
        ? `How many lines of symmetry does this shape have? (It is ${aOrAn(shape.name)} ${shape.name}.)`
        : `How many lines of symmetry does ${aOrAn(shape.name)} ${shape.name} have?`,
      ...(shape.picture ? { stemData: shape.picture, type: "VISUAL_DIAGRAM" as const } : {}),
      explanation: `A line of symmetry folds a shape so that the two halves fit exactly on each other. ${aOrAn(shape.name) === "an" ? "An" : "A"} ${shape.name} has ${shape.lines === 0 ? "no" : shape.lines} line${shape.lines === 1 ? "" : "s"} of symmetry.`,
      hints: [
        "A line of symmetry is a fold line: if you fold the shape along it, the two halves match exactly.",
        "Imagine folding the shape in different ways, or imagine a mirror standing on the line.",
        shape.lines === 0
          ? "Try folding along each diagonal and each middle line: do the halves match?"
          : "Check the lines that go through the corners and the lines that go through the middle of the sides.",
      ],
    };
    if (d <= 3)
      return q.mcq({ ...common, correct: String(shape.lines), wrongs: wrongs.slice(0, 3) });
    return q.numeric({ ...common, answer: String(shape.lines), wrongs });
  },
});

// ── parts of a circle ───────────────────────────────────────────────────────────────────────────

const CIRCLE_PARTS = [
  "radius",
  "diameter",
  "chord",
  "arc",
  "circumference",
  "centre",
  "semicircle",
] as const;
const CIRCLE_WORDS: Record<(typeof CIRCLE_PARTS)[number], string> = {
  radius: "radius",
  diameter: "diameter",
  chord: "chord",
  arc: "arc",
  circumference: "circumference",
  centre: "centre",
  semicircle: "semi-circle",
};

const CIRCLE_DEFINITIONS: Record<(typeof CIRCLE_PARTS)[number], string> = {
  radius: "a straight line from the centre of a circle to its edge",
  diameter: "a straight line across a circle that passes through the centre",
  chord: "a straight line that joins two points on the edge of a circle",
  arc: "a part of the edge of a circle",
  circumference: "the distance all the way round the edge of a circle",
  centre: "the point in the middle of a circle",
  semicircle: "half of a circle",
};

export const circleParts = defineTemplate({
  id: "mea.circle-parts",
  description: "Name the parts of a circle (Grade 6 adds the circumference; Grade 7 does not).",
  covers: (o) => scoped(o, { topic: MEA, strand: /^shapes/, text: /parts of a circle/i }),
  generate: ({ objective: o, difficulty: d, rng, q }) => {
    // The printed Content: G6 "centre, diameter, circumference, radius, chord, arc, semi-circle";
    // G7 "centre, diameter, radius, chord, arc, semi-circle".
    const allowed = CIRCLE_PARTS.filter((p) => o.grade === 6 || p !== "circumference");
    const easy = allowed.filter((p) => ["radius", "diameter", "centre", "chord"].includes(p));
    const part = rng.pick(d <= 2 ? easy : allowed);
    const correct = CIRCLE_WORDS[part];
    const mode = d <= 3 ? "picture" : rng.pick(["picture", "describe", "radius"] as const);
    const wrongNames = rng
      .sample(
        allowed.filter((p) => p !== part),
        3,
      )
      .map((p) => ({ answer: CIRCLE_WORDS[p] }));
    if (mode === "describe") {
      return q.mcq({
        skill: "KNOWLEDGE_COMPREHENSION",
        stem: `Which part of a circle is ${CIRCLE_DEFINITIONS[part]}?`,
        correct,
        wrongs: wrongNames,
        explanation: `The ${correct} is ${CIRCLE_DEFINITIONS[part]}.`,
        hints: [
          "Picture a circle and the different parts that can be marked on it.",
          "Cross out the choices that describe a different part of a circle.",
        ],
      });
    }
    if (mode === "radius") {
      const r = rng.int(2, 30);
      const toDiameter = rng.chance(0.5);
      return q.numeric({
        skill: "APPLICATION",
        stem: toDiameter
          ? `The radius of a circle is ${r} cm. What is its diameter in centimetres?`
          : `The diameter of a circle is ${r * 2} cm. What is its radius in centimetres?`,
        answer: String(toDiameter ? r * 2 : r),
        wrongs: [
          { answer: String(toDiameter ? r : r * 4) },
          { answer: String(toDiameter ? r * 3 : r * 2 + 2) },
          { answer: String(toDiameter ? r + 2 : r + 1) },
        ],
        explanation: toDiameter
          ? `The diameter goes across the whole circle through the centre, so it is two radii: 2 × ${r} = ${r * 2} cm.`
          : `The radius is half of the diameter: ${r * 2} ÷ 2 = ${r} cm.`,
        hints: [
          "The diameter is made of two radii placed end to end.",
          toDiameter ? "Double the radius." : "Halve the diameter.",
        ],
      });
    }
    return q.mcq({
      skill: "KNOWLEDGE_COMPREHENSION",
      type: "VISUAL_DIAGRAM",
      stem: "What is the name of the part of the circle that is marked in the picture?",
      stemData: { kind: "circle-part", highlight: part },
      correct,
      wrongs: wrongNames,
      explanation: `The marked part is the ${correct}: it is ${CIRCLE_DEFINITIONS[part]}.`,
      hints: [
        "Look carefully at the marked part: is it a point, a straight line or a curve? Where does it start and where does it end?",
        `The marked part is ${CIRCLE_DEFINITIONS[part]}. What is it called?`,
      ],
    });
  },
});

// ── perimeter ───────────────────────────────────────────────────────────────────────────────────

export const perimeter = defineTemplate({
  id: "mea.perimeter",
  description: "Perimeter of squares, rectangles, triangles, kites, regular polygons and L-shapes.",
  covers: (o) => scoped(o, { topic: MEA, strand: /^perimeter/ }),
  generate: ({ objective: o, difficulty: d, rng, q }) => {
    const grade = o.grade;
    const kinds: Array<
      "square" | "rectangle" | "triangle" | "kite" | "polygon" | "lshape" | "missing"
    > =
      grade <= 4
        ? ["square", "rectangle", "triangle", "rectangle"]
        : grade === 5
          ? ["square", "rectangle", "triangle", "kite", "polygon", "rectangle"]
          : ["rectangle", "triangle", "polygon", "lshape", "kite", "missing"];
    const lowLevel = d <= 2 ? kinds.filter((k) => k === "square" || k === "rectangle") : kinds;
    const kind = rng.pick(d >= 4 && grade >= 5 ? kinds.filter((k) => k !== "square") : lowLevel);
    const maxSide = ({ 3: 12, 4: 25, 5: 30, 6: 60, 7: 100 } as Record<number, number>)[grade]!;
    const unit = grade <= 4 && d <= 3 ? "cm" : rng.pick(["cm", "m"]);
    const side = () =>
      rng.int(3, Math.max(4, Math.min(maxSide, byLevel(d, [8, 12, 18, 30, maxSide]))));
    const base = {
      skill: "APPLICATION" as const,
      unit,
      local: false,
    };
    const walkHint = "Walk round the shape with your finger and add the length of EVERY side.";

    if (kind === "square") {
      const s = side();
      return measure(q, {
        ...base,
        stem: `A square has sides of ${s} ${unit}. What is its perimeter?`,
        value: 4 * s,
        wrongs: [
          { value: s * s, tag: "AREA_VS_PERIMETER" },
          { value: 2 * s, tag: "PERIMETER_SIDES_MISSED" },
          { value: 3 * s, tag: "PERIMETER_SIDES_MISSED" },
          { value: s + 4 },
        ],
        explanation: `A square has 4 equal sides. Perimeter = 4 × ${s} = ${4 * s} ${unit}.`,
        hints: [
          "The perimeter is the distance all the way round the shape.",
          "A square has 4 sides that are all the same length.",
          "Add the four sides, or multiply one side by 4.",
        ],
      });
    }
    if (kind === "rectangle") {
      const l = side() + 1;
      const w = Math.max(2, side() - 1);
      return measure(q, {
        ...base,
        type: "VISUAL_DIAGRAM",
        stem: "What is the perimeter of this rectangle?",
        stemData: { kind: "rectangle", length: l, width: w, unit, showLabels: true },
        value: 2 * (l + w),
        wrongs: [
          { value: l + w, tag: "PERIMETER_SIDES_MISSED" },
          { value: l * w, tag: "AREA_VS_PERIMETER" },
          { value: 2 * l + w, tag: "PERIMETER_SIDES_MISSED" },
          { value: l + 2 * w, tag: "PERIMETER_SIDES_MISSED" },
        ],
        explanation: `Opposite sides of a rectangle are equal, so there are two sides of ${l} ${unit} and two of ${w} ${unit}. Perimeter = ${l} + ${w} + ${l} + ${w} = ${2 * (l + w)} ${unit}.`,
        hints: [
          "The perimeter is the distance all the way round the shape.",
          "Only two sides are marked, but a rectangle has four sides: opposite sides are equal.",
          walkHint,
        ],
      });
    }
    if (kind === "triangle") {
      const a = side();
      const b = side();
      const c = Math.max(Math.abs(a - b) + 1, Math.min(a + b - 1, side()));
      return measure(q, {
        ...base,
        stem: `A triangle has sides of ${a} ${unit}, ${b} ${unit} and ${c} ${unit}. What is its perimeter?`,
        value: a + b + c,
        wrongs: [
          { value: a + b, tag: "PERIMETER_SIDES_MISSED" },
          { value: a + c, tag: "PERIMETER_SIDES_MISSED" },
          { value: Math.round(((a + b + c) * 10) / 2) / 10 },
          { value: a + b + c + 10 },
        ],
        explanation: `Perimeter = ${a} + ${b} + ${c} = ${a + b + c} ${unit}.`,
        hints: [
          "The perimeter is the distance all the way round the shape.",
          "A triangle has three sides: add all of them.",
        ],
      });
    }
    if (kind === "kite") {
      // two short sides next to each other, two longer sides next to each other
      const shortSide = side();
      const longSide = shortSide + rng.int(2, Math.max(3, Math.floor(shortSide / 2) + 2));
      return measure(q, {
        ...base,
        type: "VISUAL_DIAGRAM",
        stem: `The picture shows a kite. Two of its sides are ${shortSide} ${unit} long and the other two are ${longSide} ${unit} long. What is its perimeter?`,
        stemData: { kind: "polygon", sides: 4, regular: false, shape: "kite" },
        value: 2 * (shortSide + longSide),
        wrongs: [
          { value: shortSide + longSide, tag: "PERIMETER_SIDES_MISSED" },
          { value: shortSide * longSide, tag: "AREA_VS_PERIMETER" },
          { value: 4 * longSide, tag: "PERIMETER_SIDES_MISSED" },
        ],
        explanation: `A kite has two pairs of equal sides: ${shortSide} + ${shortSide} + ${longSide} + ${longSide} = ${2 * (shortSide + longSide)} ${unit}.`,
        hints: [
          "A kite has four sides. The sides next to each other come in equal pairs.",
          walkHint,
        ],
      });
    }
    if (kind === "polygon") {
      const n = grade === 5 ? 5 : rng.int(5, 10);
      const s = side();
      const name = POLYGON_NAMES[n]!;
      return measure(q, {
        ...base,
        type: "VISUAL_DIAGRAM",
        stem: `The picture shows a regular ${name}: all its ${n} sides are equal. Each side is ${s} ${unit} long. What is its perimeter?`,
        stemData: { kind: "polygon", sides: n, regular: true },
        value: n * s,
        wrongs: [
          { value: (n - 1) * s, tag: "PERIMETER_SIDES_MISSED" },
          { value: s * s, tag: "AREA_VS_PERIMETER" },
          { value: n + s },
          { value: (n + 1) * s, tag: "PERIMETER_SIDES_MISSED" },
        ],
        explanation: `A ${name} has ${n} equal sides, so the perimeter is ${n} × ${s} = ${n * s} ${unit}.`,
        hints: [
          `A ${name} has ${n} sides: count them.`,
          "All the sides are equal, so multiply the length of one side by the number of sides.",
        ],
      });
    }
    if (kind === "lshape") {
      const length = rng.int(8, byLevel(d, [14, 18, 24, 30, 40]));
      const width = rng.int(6, Math.max(7, length - 2));
      const cutLength = rng.int(2, length - 3);
      const cutWidth = rng.int(2, width - 2);
      return measure(q, {
        ...base,
        type: "VISUAL_DIAGRAM",
        stem: `The picture shows an L-shape. The outside length is ${length} ${unit} and the outside width is ${width} ${unit}. A corner ${cutLength} ${unit} by ${cutWidth} ${unit} is missing. What is the perimeter of the L-shape?`,
        stemData: { kind: "l-shape", length, width, cutLength, cutWidth, unit },
        value: 2 * (length + width),
        wrongs: [
          { value: length + width + cutLength + cutWidth, tag: "PERIMETER_SIDES_MISSED" },
          { value: length * width - cutLength * cutWidth, tag: "AREA_VS_PERIMETER" },
          { value: length + width, tag: "PERIMETER_SIDES_MISSED" },
        ],
        explanation: `The L-shape has 6 sides. The missing corner does not change the distance round the outside: the perimeter is the same as that of the full rectangle, 2 × (${length} + ${width}) = ${2 * (length + width)} ${unit}.`,
        hints: [
          "An L-shape has six sides. Only some of them are marked.",
          "Slide the sides of the missing corner to the outside edge: the distance round stays the same.",
          "The perimeter equals the perimeter of the rectangle that would surround the L-shape.",
        ],
      });
    }
    // missing side
    const w = Math.max(3, side() - 1);
    const l = w + rng.int(1, 8);
    return measure(q, {
      ...base,
      stem: `The perimeter of a rectangle is ${2 * (l + w)} ${unit}. Its length is ${l} ${unit}. What is its width?`,
      value: w,
      wrongs: [
        { value: 2 * (l + w) - l, tag: "PERIMETER_SIDES_MISSED" },
        { value: 2 * (l + w) - 2 * l, tag: "PERIMETER_SIDES_MISSED" },
        { value: l + w },
        { value: w + 1 },
      ],
      explanation: `Length + width is half of the perimeter: ${2 * (l + w)} ÷ 2 = ${l + w} ${unit}. So the width is ${l + w} − ${l} = ${w} ${unit}.`,
      hints: [
        "A rectangle has two lengths and two widths. The perimeter is the total of all four sides.",
        "Half of the perimeter is the length plus the width.",
        "Take the length away from that half.",
      ],
    });
  },
});

// ── area ────────────────────────────────────────────────────────────────────────────────────────

export const areaCounting = defineTemplate({
  id: "mea.area-count",
  description: "Estimate area by counting squares (non-standard units).",
  covers: (o) =>
    scoped(o, {
      topic: MEA,
      strand: /^area/,
      text: /non-standard units|estimate the area/i,
    }),
  generate: ({ objective: o, difficulty: d, rng, q }) => {
    const rows = rng.int(2, byLevel(d, [4, 6, 8, 9, 10]));
    const cols = rng.int(2, byLevel(d, [5, 7, 9, 10, 10]));
    const shape =
      o.grade >= 5 && d >= 3
        ? rng.pick(["rect", "partial", "triangle"] as const)
        : rng.pick(["rect", "partial"] as const);
    if (shape === "triangle") {
      const whole = rng.int(4, 20);
      const halves = rng.int(2, 8) * 2;
      return q.numeric({
        skill: "APPLICATION",
        stem: `A triangle is drawn on squared paper. It covers ${whole} whole squares and ${halves} half squares. Each square is 1 square unit. About how many square units is the area of the triangle?`,
        answer: String(whole + halves / 2),
        wrongs: [
          { answer: String(whole + halves) },
          { answer: String(whole) },
          { answer: String(whole * halves) },
        ].filter((w) => Number(w.answer) !== whole + halves / 2),
        explanation: `Two half squares make one whole square: ${halves} half squares = ${halves / 2} squares. Area = ${whole} + ${halves / 2} = ${whole + halves / 2} square units.`,
        hints: [
          "Count the whole squares first.",
          "Two half squares fit together to make one whole square.",
        ],
      });
    }
    const shaded =
      shape === "rect"
        ? rows * cols
        : rows * cols - rng.int(1, Math.max(1, Math.floor((rows * cols) / 3)));
    return q.numeric({
      skill: "KNOWLEDGE_COMPREHENSION",
      type: "VISUAL_DIAGRAM",
      stem: "Each small square is 1 square unit. What is the area of the shaded part, in square units?",
      stemData: { kind: "grid", rows, cols, shaded: Math.min(100, shaded) },
      answer: String(Math.min(100, shaded)),
      wrongs: [
        { answer: String(2 * (rows + cols)), tag: "AREA_VS_PERIMETER" },
        { answer: String(rows + cols) },
        { answer: String(shaded + 1) },
      ].filter((w) => Number(w.answer) !== shaded),
      explanation: `Area is the number of unit squares that cover the shape. ${shape === "rect" ? `${rows} rows of ${cols} squares: ${rows} × ${cols} = ${shaded} square units.` : `${shaded} squares are shaded, so the area is ${shaded} square units.`}`,
      hints: [
        "The area is the amount of flat space inside the shape, measured in squares.",
        shape === "rect"
          ? "Count the squares in one row, then multiply by the number of rows."
          : "Count the shaded squares carefully, row by row.",
      ],
    });
  },
});

export const areaFormulas = defineTemplate({
  id: "mea.area-formula",
  description: "Area of squares, rectangles and triangles using formulae.",
  covers: (o) =>
    scoped(o, {
      topic: MEA,
      strand: /^area/,
      text: /(?:find|calculate|compute) area of .*(?:square|rectangle|triangle)/i,
      not: /hectare|\bares\b/i,
    }),
  generate: ({ objective: o, difficulty: d, rng, q }) => {
    const t = o.text.toLowerCase();
    const kinds: Array<"square" | "rectangle" | "triangle" | "right-triangle" | "missing"> = [];
    if (/square/.test(t)) kinds.push("square");
    if (/rectangle/.test(t)) kinds.push("rectangle");
    if (/right\s*-?\s*angled triangle/.test(t)) kinds.push("right-triangle");
    else if (/triangle/.test(t)) kinds.push("triangle");
    if (kinds.length === 0) kinds.push("rectangle");
    if (d >= 4 && o.grade >= 4 && kinds.includes("rectangle")) kinds.push("missing");
    const kind = rng.pick(kinds);
    const maxSide = ({ 3: 12, 4: 20, 5: 30, 6: 40, 7: 60 } as Record<number, number>)[o.grade]!;
    const side = () =>
      rng.int(3, Math.max(4, Math.min(maxSide, byLevel(d, [8, 12, 16, 24, maxSide]))));
    const unit = o.grade <= 4 || d <= 3 ? "cm" : rng.pick(["cm", "m"]);
    const area2 = unit === "cm" ? "cm²" : "m²";
    const base = { skill: "APPLICATION" as const, unit: area2, local: false };
    if (kind === "square") {
      const s = side();
      return measure(q, {
        ...base,
        stem: `A square has sides of ${s} ${unit}. What is its area?`,
        value: s * s,
        wrongs: [
          { value: 4 * s, tag: "AREA_VS_PERIMETER" },
          { value: 2 * s, tag: "AREA_VS_PERIMETER" },
          { value: s * s + s },
        ],
        explanation: `Area of a square = side × side = ${s} × ${s} = ${s * s} ${area2}.`,
        hints: [
          "Area is the amount of flat space inside the shape, measured in square units.",
          "For a square, multiply the length of one side by itself.",
          "Do not add the sides: that would give the distance round the shape (the perimeter).",
        ],
      });
    }
    if (kind === "rectangle") {
      const l = side() + 1;
      const w = Math.max(2, side() - 1);
      return measure(q, {
        ...base,
        type: "VISUAL_DIAGRAM",
        stem: "What is the area of this rectangle?",
        stemData: { kind: "rectangle", length: l, width: w, unit, showLabels: true },
        value: l * w,
        wrongs: [
          { value: 2 * (l + w), tag: "AREA_VS_PERIMETER" },
          { value: l + w, tag: "AREA_VS_PERIMETER" },
          { value: l * w + l },
        ],
        explanation: `Area of a rectangle = length × width = ${l} × ${w} = ${l * w} ${area2}.`,
        hints: [
          "Area is the amount of flat space inside the shape, measured in square units.",
          "For a rectangle, multiply the length by the width.",
          "Do not add the sides: that would give the perimeter.",
        ],
      });
    }
    if (kind === "right-triangle" || kind === "triangle") {
      const b = side();
      const h = 2 * Math.max(2, Math.floor(side() / 2));
      return measure(q, {
        ...base,
        type: "VISUAL_DIAGRAM",
        stem:
          kind === "right-triangle"
            ? `The picture shows a right-angled triangle with base ${b} ${unit} and height ${h} ${unit}. What is its area?`
            : `This triangle has a base of ${b} ${unit} and a height of ${h} ${unit}. What is its area?`,
        stemData: { kind: "triangle", base: b, height: h, unit },
        value: (b * h) / 2,
        wrongs: [
          { value: b * h },
          { value: b + h, tag: "AREA_VS_PERIMETER" },
          { value: (b * h) / 4 },
        ],
        explanation: `Area of a triangle = ½ × base × height = ½ × ${b} × ${h} = ${(b * h) / 2} ${area2}.`,
        hints: [
          "A triangle is half of a rectangle with the same base and height.",
          "First multiply the base by the height.",
          "Then take half of that.",
        ],
      });
    }
    const l = rng.int(4, maxSide);
    const w = rng.int(3, Math.max(4, Math.floor(maxSide / 2)));
    return measure(q, {
      ...base,
      stem: `The area of a rectangle is ${l * w} ${area2}. Its length is ${l} ${unit}. What is its width in ${unit}?`,
      unit,
      value: w,
      wrongs: [
        { value: l * w - l },
        { value: l * w * l },
        { value: (l * w) / 2 },
        { value: w + 1 },
      ],
      explanation: `Area = length × width, so width = area ÷ length = ${l * w} ÷ ${l} = ${w} ${unit}.`,
      hints: [
        "Area = length × width.",
        "To find the missing side, do the opposite of multiplying: divide.",
      ],
    });
  },
});

export const areaComposite = defineTemplate({
  id: "mea.area-composite",
  description: "Area of composite shapes made from rectangles and triangles.",
  covers: (o) =>
    scoped(o, {
      topic: MEA,
      strand: /^area/,
      text: /composite|combined/i,
    }),
  generate: ({ difficulty: d, rng, q }) => {
    const unit = rng.pick(["cm", "m"]);
    const area2 = unit === "cm" ? "cm²" : "m²";
    const mode = d <= 2 ? "lshape" : rng.pick(["lshape", "house", "lshape"] as const);
    if (mode === "house") {
      const w = rng.int(4, 10) * 2;
      const h = rng.int(3, unit === "m" ? 6 : 9);
      const roof = rng.int(2, unit === "m" ? 4 : 6);
      const rect = w * h;
      const tri = (w * roof) / 2;
      return measure(q, {
        skill: "PROBLEM_SOLVING",
        unit: area2,
        stem:
          unit === "m"
            ? `The end wall of a barn is made of a rectangle ${w} m wide and ${h} m high, with a triangle on top (the gable). The triangle has the same base as the rectangle and a height of ${roof} m. What is the total area of the end wall?`
            : `A paper cut-out of a house is made of a rectangle ${w} cm wide and ${h} cm high, with a triangle on top for the roof. The triangle has the same base as the rectangle and a height of ${roof} cm. What is the area of the whole cut-out?`,
        value: rect + tri,
        wrongs: [
          { value: rect + w * roof },
          { value: rect },
          { value: rect * tri },
          { value: 2 * (w + h) + 2 * roof, tag: "AREA_VS_PERIMETER" },
        ],
        explanation: `Rectangle: ${w} × ${h} = ${rect} ${area2}. Triangle: ½ × ${w} × ${roof} = ${tri} ${area2}. Total = ${rect} + ${tri} = ${rect + tri} ${area2}.`,
        hints: [
          "Split the shape into simpler shapes: a rectangle and a triangle.",
          "Find the area of each part, using ½ × base × height for the triangle.",
          "Add the two areas.",
        ],
      });
    }
    const length = rng.int(8, byLevel(d, [14, 16, 20, 26, 40]));
    const width = rng.int(6, Math.max(7, length - 2));
    const cutLength = rng.int(2, length - 3);
    const cutWidth = rng.int(2, width - 2);
    return measure(q, {
      skill: "PROBLEM_SOLVING",
      type: "VISUAL_DIAGRAM",
      unit: area2,
      stem: `The picture shows an L-shape. The outside length is ${length} ${unit} and the outside width is ${width} ${unit}. A corner ${cutLength} ${unit} by ${cutWidth} ${unit} is missing. What is the area of the L-shape?`,
      stemData: { kind: "l-shape", length, width, cutLength, cutWidth, unit },
      value: length * width - cutLength * cutWidth,
      wrongs: [
        { value: length * width },
        { value: length * width + cutLength * cutWidth },
        { value: 2 * (length + width), tag: "AREA_VS_PERIMETER" },
        { value: cutLength * cutWidth },
      ],
      explanation: `Area of the whole rectangle: ${length} × ${width} = ${length * width} ${area2}. Take away the missing corner: ${cutLength} × ${cutWidth} = ${cutLength * cutWidth} ${area2}. Area = ${length * width} − ${cutLength * cutWidth} = ${length * width - cutLength * cutWidth} ${area2}.`,
      hints: [
        "Imagine the missing corner is filled in to make a full rectangle.",
        "Find the area of the full rectangle, then take away the area of the missing corner.",
      ],
    });
  },
});

const AREA_UNIT_ITEMS: Bank[] = [
  {
    stem: "Which unit is best for measuring the area of a classroom floor?",
    correct: "square metres (m²)",
    wrongs: ["square centimetres (cm²)", "hectares (ha)", "metres (m)"],
    explanation:
      "A classroom floor is a few metres across, so its area is measured in square metres.",
    hints: ["Area uses square units. Which square unit is the right size for a room?"],
  },
  {
    stem: "Which unit is best for measuring the area of a large farm?",
    correct: "hectares (ha)",
    wrongs: ["square centimetres (cm²)", "square metres (m²)", "centimetres (cm)"],
    explanation: "A farm is very big, so its area is measured in hectares.",
    hints: [
      "A hectare is the same as 10 000 square metres. Which unit suits a very large piece of land?",
    ],
  },
  {
    stem: "Which unit is best for measuring the area of a postage stamp?",
    correct: "square centimetres (cm²)",
    wrongs: ["hectares (ha)", "square metres (m²)", "metres (m)"],
    explanation: "A stamp is tiny, so its area is measured in square centimetres.",
    hints: ["Which square unit is small enough for something the size of a stamp?"],
  },
  {
    stem: "Which of these is a unit of area?",
    correct: "square metre",
    wrongs: ["metre", "litre", "kilogram"],
    explanation:
      "A square metre measures area. The metre measures length, the litre capacity and the kilogram mass.",
    hints: ["Area is measured in square units."],
  },
  {
    stem: "How many square metres make 1 hectare?",
    correct: "10 000",
    wrongs: ["100", "1 000", "100 000"],
    explanation: "1 hectare = 10 000 m² (a square 100 m by 100 m).",
    hints: ["A hectare is a square with sides of 100 m."],
  },
  {
    stem: "How many square metres make 1 are?",
    correct: "100",
    wrongs: ["10", "1 000", "10 000"],
    explanation: "1 are = 100 m² (a square 10 m by 10 m).",
    hints: ["An are is a square with sides of 10 m."],
  },
];

export const areaUnits = defineTemplate({
  id: "mea.area-units",
  description: "Units of area (m², are, hectare) and changing between them.",
  covers: (o) =>
    scoped(o, {
      topic: MEA,
      strand: /^area/,
      text: /identify units of area|square metres, ares and hectares/i,
    }),
  generate: ({ objective: o, difficulty: d, rng, q, local }) => {
    if (/identify/i.test(o.text)) {
      const item = rng.pick(AREA_UNIT_ITEMS);
      return q.mcq({
        skill: "KNOWLEDGE_COMPREHENSION",
        stem: item.stem,
        correct: item.correct,
        wrongs: item.wrongs.map((answer) => ({ answer })),
        explanation: item.explanation,
        hints:
          item.hints.length >= 2
            ? item.hints
            : [...item.hints, "Cross out the units that cannot measure area."],
      });
    }
    const mode = rng.pick(["field", "to-m2", "are"] as const);
    if (mode === "field") {
      const l = rng.pick([100, 200, 250, 400, 500, 50]);
      const w = rng.pick([20, 40, 50, 100, 200]);
      const area = l * w;
      const ha = area / 10000;
      return measure(q, {
        skill: "PROBLEM_SOLVING",
        type: "WORD_PROBLEM",
        unit: "ha",
        stem: `${local ? "A farmer's maize field" : "A field"} is ${l} m long and ${w} m wide. What is its area in hectares? (1 hectare = 10 000 m².)`,
        value: ha,
        local,
        wrongs: [
          { value: area, tag: "UNIT_CONVERSION_ERROR" },
          { value: area / 100, tag: "UNIT_CONVERSION_ERROR" },
          { value: ha * 10, tag: "UNIT_CONVERSION_ERROR" },
          { value: ha / 10, tag: "UNIT_CONVERSION_ERROR" },
        ],
        explanation: `Area = ${l} × ${w} = ${fmtInt(area)} m². ${fmtInt(area)} ÷ 10 000 = ${fmtDecimal(trimmedDecimal(Math.round(ha * 100), 2))} hectares.`,
        hints: [
          "First find the area in square metres: length × width.",
          "1 hectare is 10 000 square metres. Changing to the bigger unit gives a smaller number: divide.",
        ],
      });
    }
    if (mode === "to-m2") {
      const ha = rng.pick([0.5, 1, 1.5, 2, 2.5, 3, 4, 5]);
      return measure(q, {
        skill: "APPLICATION",
        unit: "m²",
        stem: `${fmtDecimal(trimmedDecimal(Math.round(ha * 100), 2))} hectares = ___ square metres`,
        value: ha * 10000,
        wrongs: [
          { value: ha * 100, tag: "UNIT_CONVERSION_ERROR" },
          { value: ha * 1000, tag: "UNIT_CONVERSION_ERROR" },
          { value: ha * 100000, tag: "UNIT_CONVERSION_ERROR" },
        ],
        explanation: `1 hectare = 10 000 m², so ${ha} ha = ${ha} × 10 000 = ${fmtInt(ha * 10000)} m².`,
        hints: [
          "1 hectare is a square 100 m by 100 m. How many square metres is that?",
          "Changing to the smaller unit gives a bigger number: multiply.",
        ],
      });
    }
    const ares = rng.int(2, byLevel(d, [9, 20, 50, 80, 99]));
    return measure(q, {
      skill: "APPLICATION",
      unit: "m²",
      stem: `${ares} ares = ___ square metres (1 are = 100 m²)`,
      value: ares * 100,
      wrongs: [
        { value: ares * 10, tag: "UNIT_CONVERSION_ERROR" },
        { value: ares * 1000, tag: "UNIT_CONVERSION_ERROR" },
        { value: ares / 100, tag: "UNIT_CONVERSION_ERROR" },
      ],
      explanation: `1 are = 100 m², so ${ares} ares = ${ares} × 100 = ${fmtInt(ares * 100)} m².`,
      hints: ["Each are is 100 square metres.", "Multiply the number of ares by 100."],
    });
  },
});

export const geometryTemplates = [
  polygonNames,
  shapeKnowledge,
  shapePatterns,
  symmetryLines,
  circleParts,
  perimeter,
  areaCounting,
  areaFormulas,
  areaComposite,
  areaUnits,
];

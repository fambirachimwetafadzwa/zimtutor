import type { StemData } from "@/lib/questions/types";
import { Drawing, RightAngleMark, Text, fromEast, plainNumber } from "./common";

type Of<K extends StemData["kind"]> = Extract<StemData, { kind: K }>;

const outline = "fill-brand/15 stroke-brand";

export function RectanglePicture({ data }: { data: Of<"rectangle"> }) {
  const W = 360;
  const H = 240;
  const s = Math.min(250 / data.length, 160 / data.width);
  const w = data.length * s;
  const h = data.width * s;
  const x = (W - w) / 2;
  const y = (H - h) / 2 + 6;
  return (
    <Drawing viewBox={`0 0 ${W} ${H}`} label="A rectangle" maxWidth="max-w-sm">
      <rect x={x} y={y} width={w} height={h} className={outline} strokeWidth={3} />
      {data.showLabels ? (
        <>
          <Text x={x + w / 2} y={y - 8} size={14} weight={600}>
            {plainNumber(data.length)} {data.unit}
          </Text>
          <Text x={x + w + 10} y={y + h / 2 + 5} size={14} weight={600} anchor="start">
            {plainNumber(data.width)} {data.unit}
          </Text>
        </>
      ) : null}
    </Drawing>
  );
}

export function LShapePicture({ data }: { data: Of<"l-shape"> }) {
  const W = 380;
  const H = 250;
  const s = Math.min(240 / data.length, 160 / data.width);
  const L = data.length * s;
  const Wd = data.width * s;
  const cl = data.cutLength * s;
  const cw = data.cutWidth * s;
  const x = (W - L) / 2 - 10;
  const y = (H - Wd) / 2 + 8;
  const points = [
    [x, y + Wd],
    [x, y],
    [x + L - cl, y],
    [x + L - cl, y + cw],
    [x + L, y + cw],
    [x + L, y + Wd],
  ]
    .map(([px, py]) => `${px},${py}`)
    .join(" ");
  return (
    <Drawing viewBox={`0 0 ${W} ${H}`} label="An L-shaped figure" maxWidth="max-w-sm">
      <rect
        x={x + L - cl}
        y={y}
        width={cl}
        height={cw}
        fill="none"
        className="stroke-muted"
        strokeDasharray="5 4"
        strokeWidth={1.5}
      />
      <polygon points={points} className={outline} strokeWidth={3} strokeLinejoin="round" />
      <Text x={x + L / 2} y={y + Wd + 20} size={14} weight={600}>
        {plainNumber(data.length)} {data.unit}
      </Text>
      <Text x={x - 8} y={y + Wd / 2 + 5} size={14} weight={600} anchor="end">
        {plainNumber(data.width)} {data.unit}
      </Text>
      <Text x={x + L - cl / 2} y={y - 8} size={13} weight={600}>
        {plainNumber(data.cutLength)} {data.unit}
      </Text>
      <Text x={x + L + 8} y={y + cw / 2 + 5} size={13} weight={600} anchor="start">
        {plainNumber(data.cutWidth)} {data.unit}
      </Text>
    </Drawing>
  );
}

export function TrianglePicture({ data }: { data: Of<"triangle"> }) {
  const W = 380;
  const H = 250;
  const s = Math.min(270 / data.base, 160 / data.height);
  const b = data.base * s;
  const h = data.height * s;
  const x = (W - b) / 2;
  const y = (H - h) / 2 - 4;
  const apexX = x + b * 0.32;
  return (
    <Drawing viewBox={`0 0 ${W} ${H}`} label="A triangle with its height drawn" maxWidth="max-w-sm">
      <polygon
        points={`${x},${y + h} ${x + b},${y + h} ${apexX},${y}`}
        className={outline}
        strokeWidth={3}
        strokeLinejoin="round"
      />
      <line
        x1={apexX}
        y1={y}
        x2={apexX}
        y2={y + h}
        className="stroke-foreground"
        strokeWidth={2}
        strokeDasharray="6 4"
      />
      <RightAngleMark x={apexX} y={y + h} dx1={-1} dy1={0} dx2={0} dy2={-1} size={10} />
      <Text x={x + b / 2} y={y + h + 22} size={14} weight={600}>
        {plainNumber(data.base)} {data.unit}
      </Text>
      <Text x={apexX} y={y + h / 2 + 5} size={14} weight={700}>
        {plainNumber(data.height)} {data.unit}
      </Text>
    </Drawing>
  );
}

export function CuboidPicture({ data }: { data: Of<"cuboid"> }) {
  const W = 400;
  const H = 270;
  const s = Math.min(200 / data.length, 120 / data.height, 120 / data.width);
  const L = data.length * s;
  const Hh = data.height * s;
  const ox = data.width * s * 0.55;
  const oy = data.width * s * 0.4;
  const x = (W - L - ox) / 2;
  const y = (H - Hh - oy) / 2 + oy + 6;
  const front = `${x},${y} ${x + L},${y} ${x + L},${y + Hh} ${x},${y + Hh}`;
  const top = `${x},${y} ${x + ox},${y - oy} ${x + L + ox},${y - oy} ${x + L},${y}`;
  const right = `${x + L},${y} ${x + L + ox},${y - oy} ${x + L + ox},${y + Hh - oy} ${x + L},${y + Hh}`;
  const dash = { strokeDasharray: "5 4" } as const;
  return (
    <Drawing viewBox={`0 0 ${W} ${H}`} label="A cuboid (a box shape)" maxWidth="max-w-sm">
      <polygon
        points={top}
        className="fill-brand/25 stroke-brand"
        strokeWidth={2.5}
        strokeLinejoin="round"
      />
      <polygon
        points={right}
        className="fill-brand/35 stroke-brand"
        strokeWidth={2.5}
        strokeLinejoin="round"
      />
      <polygon
        points={front}
        className="fill-brand/15 stroke-brand"
        strokeWidth={2.5}
        strokeLinejoin="round"
      />
      <line
        x1={x + ox}
        y1={y - oy}
        x2={x + ox}
        y2={y + Hh - oy}
        className="stroke-muted"
        strokeWidth={1.5}
        {...dash}
      />
      <line
        x1={x + ox}
        y1={y + Hh - oy}
        x2={x + L + ox}
        y2={y + Hh - oy}
        className="stroke-muted"
        strokeWidth={1.5}
        {...dash}
      />
      <line
        x1={x}
        y1={y + Hh}
        x2={x + ox}
        y2={y + Hh - oy}
        className="stroke-muted"
        strokeWidth={1.5}
        {...dash}
      />
      <Text x={x + L / 2} y={y + Hh + 20} size={14} weight={600}>
        {plainNumber(data.length)} {data.unit}
      </Text>
      <Text x={x - 8} y={y + Hh / 2 + 5} size={14} weight={600} anchor="end">
        {plainNumber(data.height)} {data.unit}
      </Text>
      <Text x={x + L + ox / 2 + 10} y={y + Hh - oy / 2 + 18} size={14} weight={600} anchor="start">
        {plainNumber(data.width)} {data.unit}
      </Text>
    </Drawing>
  );
}

/** Vertices of a regular polygon with a flat bottom edge, in screen coordinates. */
function regularPolygon(sides: number, cx: number, cy: number, r: number): Array<[number, number]> {
  return Array.from({ length: sides }, (_, k) => {
    const a = ((90 + 180 / sides + (360 * k) / sides) * Math.PI) / 180;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  });
}

const NAMED: Record<NonNullable<Of<"polygon">["shape"]>, Array<[number, number]>> = {
  kite: [
    [150, 20],
    [215, 95],
    [150, 205],
    [85, 95],
  ],
  rhombus: [
    [150, 25],
    [240, 110],
    [150, 195],
    [60, 110],
  ],
  parallelogram: [
    [95, 45],
    [255, 45],
    [215, 175],
    [55, 175],
  ],
  trapezium: [
    [105, 45],
    [195, 45],
    [255, 175],
    [45, 175],
  ],
};

const WOBBLE = [1, 0.78, 1.1, 0.72, 0.95, 0.85, 1.05, 0.8, 1, 0.9] as const;

export function PolygonPicture({ data }: { data: Of<"polygon"> }) {
  let pts: Array<[number, number]>;
  if (data.shape) pts = NAMED[data.shape];
  else if (data.regular) pts = regularPolygon(data.sides, 150, 112, 88);
  else
    pts = regularPolygon(data.sides, 150, 112, 88).map(([px, py], i) => {
      const k = WOBBLE[i % WOBBLE.length]!;
      return [150 + (px - 150) * k, 112 + (py - 112) * k] as [number, number];
    });
  return (
    <Drawing viewBox="0 0 300 225" label="A flat shape with straight sides" maxWidth="max-w-xs">
      <polygon
        points={pts.map(([px, py]) => `${px},${py}`).join(" ")}
        className={outline}
        strokeWidth={3}
        strokeLinejoin="round"
      />
    </Drawing>
  );
}

export function CirclePartPicture({ data }: { data: Of<"circle-part"> }) {
  const cx = 150;
  const cy = 112;
  const r = 88;
  const on = "stroke-brand";
  const thin = "stroke-foreground";
  const at = (deg: number, rr = r) => fromEast(cx, cy, rr, deg);
  const highlight = data.highlight;
  let extra: React.ReactNode = null;
  if (highlight === "radius") {
    const p = at(35);
    extra = (
      <line
        x1={cx}
        y1={cy}
        x2={p.x}
        y2={p.y}
        className={on}
        strokeWidth={5}
        strokeLinecap="round"
      />
    );
  } else if (highlight === "diameter") {
    const a = at(200);
    const b = at(20);
    extra = (
      <line
        x1={a.x}
        y1={a.y}
        x2={b.x}
        y2={b.y}
        className={on}
        strokeWidth={5}
        strokeLinecap="round"
      />
    );
  } else if (highlight === "chord") {
    const a = at(30);
    const b = at(150);
    extra = (
      <line
        x1={a.x}
        y1={a.y}
        x2={b.x}
        y2={b.y}
        className={on}
        strokeWidth={5}
        strokeLinecap="round"
      />
    );
  } else if (highlight === "arc") {
    const a = at(20);
    const b = at(115);
    extra = (
      <path
        d={`M ${a.x} ${a.y} A ${r} ${r} 0 0 0 ${b.x} ${b.y}`}
        fill="none"
        className={on}
        strokeWidth={6}
        strokeLinecap="round"
      />
    );
  } else if (highlight === "semicircle") {
    const a = at(180);
    const b = at(0);
    extra = (
      <path
        d={`M ${a.x} ${a.y} A ${r} ${r} 0 0 1 ${b.x} ${b.y} Z`}
        className="fill-brand/30 stroke-brand"
        strokeWidth={4}
        strokeLinejoin="round"
      />
    );
  }
  return (
    <Drawing viewBox="0 0 300 225" label="A circle with one part marked" maxWidth="max-w-xs">
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        className={highlight === "circumference" ? on : thin}
        strokeWidth={highlight === "circumference" ? 6 : 2}
      />
      {extra}
      <circle
        cx={cx}
        cy={cy}
        r={highlight === "centre" ? 8 : 3}
        className={highlight === "centre" ? "fill-brand" : "fill-foreground"}
      />
    </Drawing>
  );
}

export function GridPicture({ data }: { data: Of<"grid"> }) {
  const cell = Math.min(28, 280 / data.cols, 280 / data.rows);
  const W = data.cols * cell + 8;
  const H = data.rows * cell + 8;
  return (
    <Drawing
      viewBox={`0 0 ${W} ${H}`}
      label={`A grid of ${data.rows} rows and ${data.cols} columns, some squares shaded`}
      maxWidth="max-w-xs"
    >
      {Array.from({ length: data.rows * data.cols }, (_, i) => {
        const row = Math.floor(i / data.cols);
        const col = i % data.cols;
        return (
          <rect
            key={i}
            x={4 + col * cell}
            y={4 + row * cell}
            width={cell}
            height={cell}
            className={
              i < data.shaded ? "fill-brand stroke-foreground" : "fill-surface stroke-foreground"
            }
            strokeWidth={1}
          />
        );
      })}
    </Drawing>
  );
}

export function FractionBarPicture({ data }: { data: Of<"fraction-bar"> }) {
  const barW = 300;
  const barH = 36;
  const gap = 12;
  const wholes = data.wholes ?? 0;
  const bars = wholes + 1;
  const H = bars * barH + (bars - 1) * gap + 8;
  return (
    <Drawing
      viewBox={`0 0 ${barW + 8} ${H}`}
      label="Bars divided into equal parts, some parts shaded"
      maxWidth="max-w-sm"
    >
      {Array.from({ length: bars }, (_, b) => {
        const y = 4 + b * (barH + gap);
        const whole = b < wholes;
        const parts = data.parts;
        const w = barW / parts;
        return Array.from({ length: parts }, (_, p) => (
          <rect
            key={`${b}-${p}`}
            x={4 + p * w}
            y={y}
            width={w}
            height={barH}
            className={
              whole || p < data.shaded
                ? "fill-brand stroke-foreground"
                : "fill-surface stroke-foreground"
            }
            strokeWidth={1.5}
          />
        ));
      })}
    </Drawing>
  );
}

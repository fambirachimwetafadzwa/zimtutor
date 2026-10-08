import type { StemData } from "@/lib/questions/types";
import { COMPASS_DIRECTIONS } from "@/lib/questions/types";
import { Drawing, RightAngleMark, Text, fromEast, fromNorth, plainNumber } from "./common";

type Of<K extends StemData["kind"]> = Extract<StemData, { kind: K }>;

const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

export function ClockPicture({ data }: { data: Of<"clock"> }) {
  const cx = 120;
  const cy = 120;
  const r = 104;
  const hourAngle = (data.hour % 12) * 30 + data.minute * 0.5;
  const minuteAngle = data.minute * 6;
  const hourTip = fromNorth(cx, cy, 54, hourAngle);
  const minuteTip = fromNorth(cx, cy, 80, minuteAngle);
  return (
    <Drawing
      viewBox="0 0 240 240"
      label="A clock face with an hour hand and a minute hand"
      maxWidth="max-w-[16rem]"
    >
      <circle cx={cx} cy={cy} r={r} className="fill-surface stroke-foreground" strokeWidth={4} />
      {Array.from({ length: 60 }, (_, i) => {
        const major = i % 5 === 0;
        const a = fromNorth(cx, cy, r - 3, i * 6);
        const b = fromNorth(cx, cy, r - (major ? 13 : 7), i * 6);
        return (
          <line
            key={i}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            className="stroke-foreground"
            strokeWidth={major ? 2.5 : 1}
          />
        );
      })}
      {Array.from({ length: 12 }, (_, i) => {
        const p = fromNorth(cx, cy, 80, (i + 1) * 30);
        return (
          <Text key={i} x={p.x} y={p.y + 6} size={19} weight={700}>
            {i + 1}
          </Text>
        );
      })}
      <line
        x1={cx}
        y1={cy}
        x2={hourTip.x}
        y2={hourTip.y}
        className="stroke-foreground"
        strokeWidth={7}
        strokeLinecap="round"
      />
      <line
        x1={cx}
        y1={cy}
        x2={minuteTip.x}
        y2={minuteTip.y}
        className="stroke-brand"
        strokeWidth={4.5}
        strokeLinecap="round"
      />
      <circle cx={cx} cy={cy} r={6} className="fill-foreground" />
    </Drawing>
  );
}

export function RulerPicture({ data }: { data: Of<"ruler"> }) {
  const W = 470;
  const left = 22;
  const span = W - 2 * left;
  const x = (v: number) => left + (v / data.length) * span;
  const mm = data.unit === "mm";
  const count = Math.round(mm ? data.length : data.length * 10);
  const top = 78;
  const bodyH = 62;
  return (
    <Drawing
      viewBox={`0 0 ${W} 160`}
      label={`A ruler marked in ${data.unit === "cm" ? "centimetres and millimetres" : "millimetres"}, with a line drawn above it`}
    >
      <rect
        x={left - 8}
        y={top}
        width={span + 16}
        height={bodyH}
        rx={4}
        className="fill-accent/25 stroke-foreground"
        strokeWidth={2}
      />
      {Array.from({ length: count + 1 }, (_, i) => {
        const value = mm ? i : i / 10;
        const major = mm ? i % 10 === 0 : i % 10 === 0;
        const half = mm ? i % 5 === 0 : i % 5 === 0;
        const len = major ? 24 : half ? 17 : 10;
        return (
          <g key={i}>
            <line
              x1={x(value)}
              y1={top}
              x2={x(value)}
              y2={top + len}
              className="stroke-foreground"
              strokeWidth={major ? 1.8 : 1}
            />
            {major ? (
              <Text x={x(value)} y={top + 43} size={14} weight={700}>
                {mm ? i : i / 10}
              </Text>
            ) : null}
          </g>
        );
      })}
      <Text x={W - left - 4} y={top + bodyH - 8} size={11} anchor="end">
        {data.unit}
      </Text>
      <rect
        x={x(data.start)}
        y={46}
        width={x(data.end) - x(data.start)}
        height={9}
        rx={3}
        className="fill-brand"
      />
      <line
        x1={x(data.start)}
        y1={34}
        x2={x(data.start)}
        y2={top}
        className="stroke-muted"
        strokeWidth={1}
        strokeDasharray="3 3"
      />
      <line
        x1={x(data.end)}
        y1={34}
        x2={x(data.end)}
        y2={top}
        className="stroke-muted"
        strokeWidth={1}
        strokeDasharray="3 3"
      />
    </Drawing>
  );
}

export function JugPicture({ data }: { data: Of<"jug"> }) {
  const top = 34;
  const bottom = 270;
  const h = bottom - top;
  const y = (v: number) => bottom - (Math.min(v, data.capacity) / data.capacity) * h;
  const marks: number[] = [];
  for (let v = 0; v <= data.capacity + 1e-6 && marks.length < 200; v += data.step)
    marks.push(Math.round(v * 1e6) / 1e6);
  return (
    <Drawing
      viewBox="0 0 220 300"
      label={`A measuring jug marked in ${data.unit === "ml" ? "millilitres" : "litres"}`}
      maxWidth="max-w-[14rem]"
    >
      <rect
        x={72}
        y={top}
        width={64}
        height={h}
        rx={6}
        className="fill-surface stroke-foreground"
        strokeWidth={3}
      />
      <rect
        x={75}
        y={y(data.level)}
        width={58}
        height={bottom - y(data.level) - 3}
        className="fill-brand/40"
      />
      <line
        x1={75}
        y1={y(data.level)}
        x2={133}
        y2={y(data.level)}
        className="stroke-brand"
        strokeWidth={2.5}
      />
      {marks.map((v) => {
        const label =
          near(v % data.labelEvery, 0) || near((v % data.labelEvery) - data.labelEvery, 0);
        return (
          <g key={v}>
            <line
              x1={label ? 56 : 62}
              y1={y(v)}
              x2={72}
              y2={y(v)}
              className="stroke-foreground"
              strokeWidth={label ? 2 : 1}
            />
            {label ? (
              <Text x={52} y={y(v) + 5} size={14} anchor="end" weight={700}>
                {plainNumber(v)}
              </Text>
            ) : null}
          </g>
        );
      })}
      <path
        d={`M 136 ${top + 20} q 34 6 34 40 t -34 60`}
        fill="none"
        className="stroke-foreground"
        strokeWidth={3}
      />
      <Text x={104} y={22} size={13} weight={700}>
        {data.unit === "ml" ? "ml" : "litres"}
      </Text>
    </Drawing>
  );
}

export function DialScalePicture({ data }: { data: Of<"dial-scale"> }) {
  const cx = 130;
  const cy = 130;
  const r = 104;
  const sweep = 270;
  const angleOf = (v: number) => -sweep / 2 + (Math.min(v, data.max) / data.max) * sweep;
  const marks: number[] = [];
  for (let v = 0; v <= data.max + 1e-6 && marks.length < 300; v += data.step)
    marks.push(Math.round(v * 1e6) / 1e6);
  const tip = fromNorth(cx, cy, r - 20, angleOf(data.reading));
  const tail = fromNorth(cx, cy, 14, angleOf(data.reading) + 180);
  return (
    <Drawing
      viewBox="0 0 260 250"
      label={`A dial scale for weighing, marked in ${data.unit === "g" ? "grams" : "kilograms"}`}
      maxWidth="max-w-[17rem]"
    >
      <circle cx={cx} cy={cy} r={r} className="fill-surface stroke-foreground" strokeWidth={4} />
      {marks.map((v) => {
        const major =
          near(v % data.labelEvery, 0) || near((v % data.labelEvery) - data.labelEvery, 0);
        const a = fromNorth(cx, cy, r - 3, angleOf(v));
        const b = fromNorth(cx, cy, r - (major ? 16 : 9), angleOf(v));
        const t = fromNorth(cx, cy, r - 30, angleOf(v));
        return (
          <g key={v}>
            <line
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              className="stroke-foreground"
              strokeWidth={major ? 2.5 : 1.2}
            />
            {major ? (
              <Text x={t.x} y={t.y + 5} size={14} weight={700}>
                {plainNumber(v)}
              </Text>
            ) : null}
          </g>
        );
      })}
      <line
        x1={tail.x}
        y1={tail.y}
        x2={tip.x}
        y2={tip.y}
        className="stroke-brand"
        strokeWidth={4}
        strokeLinecap="round"
      />
      <circle cx={cx} cy={cy} r={7} className="fill-brand" />
      <Text x={cx} y={cy + 52} size={15} weight={700}>
        {data.unit}
      </Text>
    </Drawing>
  );
}

export function NumberLinePicture({ data }: { data: Of<"number-line"> }) {
  const W = 480;
  const left = 34;
  const right = W - 34;
  const y = 62;
  const x = (v: number) => left + ((v - data.from) / (data.to - data.from)) * (right - left);
  const marks: number[] = [];
  for (let v = data.from; v <= data.to + 1e-6 && marks.length < 400; v += data.step)
    marks.push(Math.round(v * 1e6) / 1e6);
  const isLabelled = (v: number) => data.labelled.some((l) => near(l, v));
  const custom = (v: number): string | undefined => {
    if (!data.labels) return undefined;
    for (const [key, text] of Object.entries(data.labels)) if (near(Number(key), v)) return text;
    return undefined;
  };
  return (
    <Drawing viewBox={`0 0 ${W} 116`} label="A number line">
      <line
        x1={left - 14}
        y1={y}
        x2={right + 14}
        y2={y}
        className="stroke-foreground"
        strokeWidth={2.5}
      />
      <polygon
        points={`${left - 20},${y} ${left - 11},${y - 5} ${left - 11},${y + 5}`}
        className="fill-foreground"
      />
      <polygon
        points={`${right + 20},${y} ${right + 11},${y - 5} ${right + 11},${y + 5}`}
        className="fill-foreground"
      />
      {marks.map((v) => {
        const labelled = isLabelled(v) || custom(v) !== undefined;
        return (
          <g key={v}>
            <line
              x1={x(v)}
              y1={y - (labelled ? 10 : 6)}
              x2={x(v)}
              y2={y + (labelled ? 10 : 6)}
              className="stroke-foreground"
              strokeWidth={labelled ? 2.2 : 1.2}
            />
            {labelled ? (
              <Text x={x(v)} y={y + 31} size={16} weight={700}>
                {custom(v) ?? plainNumber(v)}
              </Text>
            ) : null}
          </g>
        );
      })}
      {data.pointer !== undefined ? (
        <g>
          <line
            x1={x(data.pointer)}
            y1={y - 38}
            x2={x(data.pointer)}
            y2={y - 8}
            className="stroke-brand"
            strokeWidth={3}
          />
          <polygon
            points={`${x(data.pointer)},${y - 4} ${x(data.pointer) - 6},${y - 15} ${x(data.pointer) + 6},${y - 15}`}
            className="fill-brand"
          />
          <Text x={x(data.pointer)} y={y - 44} size={16} weight={800} className="fill-brand">
            ?
          </Text>
        </g>
      ) : null}
    </Drawing>
  );
}

export function AnglePicture({ data }: { data: Of<"angle"> }) {
  const cx = 130;
  const cy = 108;
  const len = 92;
  const deg = Math.min(data.degrees, 359.9);
  const end = fromEast(cx, cy, len, deg);
  const arcStart = fromEast(cx, cy, 30, 0);
  const arcEnd = fromEast(cx, cy, 30, deg);
  return (
    <Drawing
      viewBox="0 0 260 216"
      label="An angle drawn with two arms and an arc"
      maxWidth="max-w-xs"
    >
      <line
        x1={cx}
        y1={cy}
        x2={cx + len}
        y2={cy}
        className="stroke-foreground"
        strokeWidth={3.5}
        strokeLinecap="round"
      />
      <line
        x1={cx}
        y1={cy}
        x2={end.x}
        y2={end.y}
        className="stroke-foreground"
        strokeWidth={3.5}
        strokeLinecap="round"
      />
      {data.degrees === 90 ? (
        <RightAngleMark x={cx} y={cy} dx1={1} dy1={0} dx2={0} dy2={-1} size={16} />
      ) : (
        <path
          d={`M ${arcStart.x} ${arcStart.y} A 30 30 0 ${deg > 180 ? 1 : 0} 0 ${arcEnd.x} ${arcEnd.y}`}
          fill="none"
          className="stroke-brand"
          strokeWidth={3}
        />
      )}
      <circle cx={cx} cy={cy} r={4} className="fill-foreground" />
    </Drawing>
  );
}

export function LinePicture({ data }: { data: Of<"line"> }) {
  const cx = 130;
  const cy = 100;
  const a = fromEast(cx, cy, 92, data.degrees);
  const b = fromEast(cx, cy, 92, data.degrees + 180);
  return (
    <Drawing viewBox="0 0 260 200" label="A straight line" maxWidth="max-w-xs">
      <line
        x1={a.x}
        y1={a.y}
        x2={b.x}
        y2={b.y}
        className="stroke-brand"
        strokeWidth={5}
        strokeLinecap="round"
      />
    </Drawing>
  );
}

export function AngleSumPicture({ data }: { data: Of<"angle-sum"> }) {
  const known = data.known;
  const sum = known.reduce((a, b) => a + b, 0);
  const unknown = Math.max(0, data.total - sum);
  const cuts: number[] = [0];
  for (const k of known) cuts.push((cuts[cuts.length - 1] ?? 0) + k);
  cuts.push(data.total);
  const cx = data.total === 90 ? 70 : 150;
  const cy = data.total === 360 ? 112 : data.total === 90 ? 180 : 168;
  const R = 92;
  const wedges = cuts.slice(0, -1).map((from, i) => ({
    from,
    to: cuts[i + 1] ?? from,
    text: i < known.length ? `${plainNumber(known[i]!)}°` : "?",
  }));
  return (
    <Drawing
      viewBox="0 0 300 230"
      label="Angles that meet at a point; one of them is not known"
      maxWidth="max-w-sm"
    >
      {data.total === 180 ? (
        <line
          x1={cx - R}
          y1={cy}
          x2={cx + R}
          y2={cy}
          className="stroke-foreground"
          strokeWidth={3}
          strokeLinecap="round"
        />
      ) : null}
      {cuts.map((c, i) => {
        if (data.total === 180 && (i === 0 || i === cuts.length - 1)) return null;
        const p = fromEast(cx, cy, R, c);
        return (
          <line
            key={i}
            x1={cx}
            y1={cy}
            x2={p.x}
            y2={p.y}
            className="stroke-foreground"
            strokeWidth={3}
            strokeLinecap="round"
          />
        );
      })}
      {wedges.map((w, i) => {
        const span = w.to - w.from;
        const a0 = fromEast(cx, cy, 30, w.from);
        const a1 = fromEast(cx, cy, 30, Math.min(w.to, w.from + 359.9));
        const mid = fromEast(cx, cy, 52, w.from + span / 2);
        const isUnknown = i === wedges.length - 1 && unknown > 0;
        return (
          <g key={i}>
            <path
              d={`M ${a0.x} ${a0.y} A 30 30 0 ${span > 180 ? 1 : 0} 0 ${a1.x} ${a1.y}`}
              fill="none"
              className={isUnknown ? "stroke-brand" : "stroke-muted"}
              strokeWidth={isUnknown ? 3 : 1.5}
            />
            <Text
              x={mid.x}
              y={mid.y + 5}
              size={isUnknown ? 18 : 13}
              weight={isUnknown ? 800 : 600}
              className={isUnknown ? "fill-brand" : "fill-foreground"}
            >
              {w.text}
            </Text>
          </g>
        );
      })}
      <circle cx={cx} cy={cy} r={4} className="fill-foreground" />
    </Drawing>
  );
}

export function CompassPicture({ data }: { data: Of<"compass"> }) {
  const cx = 130;
  const cy = 130;
  const r = 86;
  const index = data.pointer ? COMPASS_DIRECTIONS.indexOf(data.pointer) : -1;
  const tip = fromNorth(cx, cy, r - 6, index * 45);
  const dirs = data.points === 8 ? 8 : 4;
  const names = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return (
    <Drawing viewBox="0 0 260 260" label="A compass rose" maxWidth="max-w-xs">
      <circle cx={cx} cy={cy} r={r} className="fill-surface stroke-foreground" strokeWidth={2.5} />
      {Array.from({ length: dirs }, (_, k) => {
        const step = 360 / dirs;
        const a = fromNorth(cx, cy, r, k * step);
        const b = fromNorth(cx, cy, r, k * step + 180);
        const main = (k * step) % 90 === 0;
        return k < dirs / 2 ? (
          <line
            key={k}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            className="stroke-muted"
            strokeWidth={main ? 1.5 : 1}
          />
        ) : null;
      })}
      {Array.from({ length: dirs }, (_, k) => {
        const idx = (k * 8) / dirs;
        const p = fromNorth(cx, cy, r + 18, k * (360 / dirs));
        return (
          <Text
            key={k}
            x={p.x}
            y={p.y + 5}
            size={idx % 2 === 0 ? 16 : 12}
            weight={idx % 2 === 0 ? 800 : 600}
          >
            {names[idx]}
          </Text>
        );
      })}
      {index >= 0 ? (
        <g>
          <line
            x1={cx}
            y1={cy}
            x2={tip.x}
            y2={tip.y}
            className="stroke-brand"
            strokeWidth={5}
            strokeLinecap="round"
          />
          <circle cx={tip.x} cy={tip.y} r={7} className="fill-brand" />
        </g>
      ) : null}
      <circle cx={cx} cy={cy} r={5} className="fill-foreground" />
    </Drawing>
  );
}

export interface LabelSpot {
  /** The name, on one or two lines. */
  lines: string[];
  x: number;
  /** Baseline of the first line. */
  y: number;
  anchor: "start" | "middle" | "end";
}

const CHAR_WIDTH = 7.8;
export const LINE_HEIGHT = 15;

/** A name on one line, or split at the space nearest the middle when it is long. */
export function splitLabel(label: string): string[] {
  if (label.length <= 8 || !label.includes(" ")) return [label];
  const words = label.split(" ");
  let best = 1;
  let bestGap = Infinity;
  for (let i = 1; i < words.length; i++) {
    const gap = Math.abs(words.slice(0, i).join(" ").length - words.slice(i).join(" ").length);
    if (gap < bestGap) [best, bestGap] = [i, gap];
  }
  return [words.slice(0, best).join(" "), words.slice(best).join(" ")];
}

/** The rectangle a written name occupies: [left, top, right, bottom]. */
export function labelBox(spot: LabelSpot): [number, number, number, number] {
  const w = Math.max(...spot.lines.map((l) => l.length)) * CHAR_WIDTH + 4;
  const x0 =
    spot.anchor === "middle" ? spot.x - w / 2 : spot.anchor === "start" ? spot.x : spot.x - w;
  return [x0, spot.y - 13, x0 + w, spot.y + 4 + (spot.lines.length - 1) * LINE_HEIGHT];
}

/**
 * Where to write each place's name so that no name covers another name or a dot: above, below, right
 * or left of its dot, whichever is free first. Long names are split over two lines.
 */
export function placeLabels(
  dots: ReadonlyArray<{ x: number; y: number; label: string }>,
  frame: { width: number; height: number },
): LabelSpot[] {
  type Box = [number, number, number, number];
  const overlaps = (a: Box, b: Box) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
  const dotBoxes = dots.map((d) => [d.x - 9, d.y - 9, d.x + 9, d.y + 9] as Box);
  // the most crowded places choose first
  const crowd = dots.map(
    (d, i) => dots.filter((o, j) => j !== i && Math.hypot(o.x - d.x, o.y - d.y) < 110).length,
  );
  const order = dots.map((_, i) => i).sort((a, b) => crowd[b]! - crowd[a]! || a - b);
  const result: LabelSpot[] = new Array(dots.length);
  const taken: Box[] = [];
  for (const index of order) {
    const dot = dots[index]!;
    const lines = splitLabel(dot.label);
    const above = dot.y - 12 - (lines.length - 1) * LINE_HEIGHT;
    const beside = dot.y + 5 - ((lines.length - 1) * LINE_HEIGHT) / 2;
    const candidates: LabelSpot[] = [
      { lines, x: dot.x, y: above, anchor: "middle" },
      { lines, x: dot.x, y: dot.y + 25, anchor: "middle" },
      { lines, x: dot.x + 13, y: beside, anchor: "start" },
      { lines, x: dot.x - 13, y: beside, anchor: "end" },
      { lines, x: dot.x + 8, y: above, anchor: "start" },
      { lines, x: dot.x - 8, y: above, anchor: "end" },
      { lines, x: dot.x + 8, y: dot.y + 25, anchor: "start" },
      { lines, x: dot.x - 8, y: dot.y + 25, anchor: "end" },
      { lines, x: dot.x, y: above - 17, anchor: "middle" },
      { lines, x: dot.x, y: dot.y + 43, anchor: "middle" },
    ];
    const cost = (c: LabelSpot) => {
      const box = labelBox(c);
      let n = 0;
      if (box[0] < 2 || box[2] > frame.width - 2 || box[1] < 2 || box[3] > frame.height - 2) n += 5;
      for (const t of taken) if (overlaps(box, t)) n += 3;
      dotBoxes.forEach((d, i) => {
        if (i !== index && overlaps(box, d)) n += 3;
      });
      return n;
    };
    let best = candidates[0]!;
    for (const c of candidates) if (cost(c) < cost(best)) best = c;
    taken.push(labelBox(best));
    result[index] = best;
  }
  return result;
}

export function MapPicture({ data }: { data: Of<"map"> }) {
  const cell = 46;
  const pad = 40;
  const W = pad * 2 + (data.cols - 1) * cell + 36;
  const H = pad * 2 + (data.rows - 1) * cell;
  const px = (col: number) => pad + col * cell;
  const py = (row: number) => pad + row * cell;
  const spots = placeLabels(
    data.places.map((p) => ({ x: px(p.col), y: py(p.row), label: p.label })),
    { width: W, height: H },
  );
  return (
    <Drawing
      viewBox={`0 0 ${W} ${H}`}
      label="A map on a grid, with north at the top"
      maxWidth="max-w-lg"
    >
      <rect
        x={2}
        y={2}
        width={W - 4}
        height={H - 4}
        rx={8}
        className="fill-surface stroke-border"
        strokeWidth={2}
      />
      {Array.from({ length: data.cols }, (_, c) => (
        <line
          key={`c${c}`}
          x1={px(c)}
          y1={pad - 14}
          x2={px(c)}
          y2={py(data.rows - 1) + 14}
          className="stroke-border"
          strokeWidth={1}
        />
      ))}
      {Array.from({ length: data.rows }, (_, r) => (
        <line
          key={`r${r}`}
          x1={pad - 14}
          y1={py(r)}
          x2={px(data.cols - 1) + 14}
          y2={py(r)}
          className="stroke-border"
          strokeWidth={1}
        />
      ))}
      {data.places.map((p, i) => (
        <circle
          key={`d${i}`}
          cx={px(p.col)}
          cy={py(p.row)}
          r={7}
          className="fill-brand stroke-surface"
          strokeWidth={2}
        />
      ))}
      {data.places.map((p, i) =>
        spots[i]!.lines.map((line, k) => (
          <Text
            key={`t${i}-${k}`}
            x={spots[i]!.x}
            y={spots[i]!.y + k * LINE_HEIGHT}
            size={14}
            weight={700}
            anchor={spots[i]!.anchor}
          >
            {line}
          </Text>
        )),
      )}
      <g>
        <polygon points={`${W - 24},10 ${W - 32},28 ${W - 16},28`} className="fill-foreground" />
        <Text x={W - 24} y={44} size={14} weight={800}>
          N
        </Text>
      </g>
    </Drawing>
  );
}

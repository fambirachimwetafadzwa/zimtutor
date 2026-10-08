import type { ReactNode } from "react";

/**
 * Shared pieces for the question pictures. Every picture is plain SVG (or a table): it scales to the
 * screen, needs no script, prints, and reads out a neutral description. A picture's description
 * says WHAT it is ("a clock face"), never what it shows when showing it IS the question: a clock
 * that announced its own time would answer "What time does the clock show?".
 */

/** Point at `degrees` clockwise from north (the top), `r` away from (cx, cy). Clocks, dials, compasses. */
export function fromNorth(cx: number, cy: number, r: number, degrees: number) {
  const a = (degrees * Math.PI) / 180;
  return { x: cx + r * Math.sin(a), y: cy - r * Math.cos(a) };
}

/** Point at `degrees` anticlockwise from east (the right), `r` away from (cx, cy). Angles and lines. */
export function fromEast(cx: number, cy: number, r: number, degrees: number) {
  const a = (degrees * Math.PI) / 180;
  return { x: cx + r * Math.cos(a), y: cy - r * Math.sin(a) };
}

/** Numbers as the syllabus prints them, without trailing zeros: 2, 2.5, 0.75. */
export function plainNumber(n: number): string {
  return String(Math.round(n * 10_000) / 10_000);
}

/** An SVG drawing with a viewBox and a description. */
export function Drawing({
  viewBox,
  label,
  detail,
  children,
  maxWidth = "max-w-md",
}: {
  viewBox: string;
  label: string;
  /** Extra text read out with the picture (the data of a chart). */
  detail?: string;
  children: ReactNode;
  maxWidth?: string;
}) {
  return (
    <svg
      viewBox={viewBox}
      role="img"
      aria-label={label}
      className={`h-auto w-full ${maxWidth} text-foreground`}
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>{label}</title>
      {detail ? <desc>{detail}</desc> : null}
      {children}
    </svg>
  );
}

export const Text = ({
  x,
  y,
  children,
  size = 12,
  anchor = "middle",
  weight,
  rotate,
  className = "fill-foreground",
}: {
  x: number;
  y: number;
  children: ReactNode;
  size?: number;
  anchor?: "start" | "middle" | "end";
  weight?: number;
  rotate?: number;
  className?: string;
}) => (
  <text
    x={x}
    y={y}
    fontSize={size}
    textAnchor={anchor}
    fontWeight={weight}
    className={className}
    // a thin white outline keeps a label readable where it crosses a line
    stroke="#ffffff"
    strokeWidth={3}
    strokeLinejoin="round"
    paintOrder="stroke"
    {...(rotate !== undefined ? { transform: `rotate(${rotate} ${x} ${y})` } : {})}
  >
    {children}
  </text>
);

/** Colours for slices and series (labels are always drawn too, so hue is never the only clue), with legible ink for each. */
export const PALETTE = [
  { fill: "#0f6b4f", ink: "#ffffff" },
  { fill: "#f2b705", ink: "#1b2a2f" },
  { fill: "#2b6cb0", ink: "#ffffff" },
  { fill: "#c05621", ink: "#ffffff" },
  { fill: "#6b46c1", ink: "#ffffff" },
  { fill: "#2c7a7b", ink: "#ffffff" },
  { fill: "#b83280", ink: "#ffffff" },
  { fill: "#718096", ink: "#ffffff" },
] as const;

export const paletteAt = (i: number) => PALETTE[i % PALETTE.length]!;

/** A square marker for a right angle at (x, y), pointing into the directions (dx1, dy1) and (dx2, dy2). */
export function RightAngleMark({
  x,
  y,
  dx1,
  dy1,
  dx2,
  dy2,
  size = 10,
}: {
  x: number;
  y: number;
  dx1: number;
  dy1: number;
  dx2: number;
  dy2: number;
  size?: number;
}) {
  const a = { x: x + dx1 * size, y: y + dy1 * size };
  const b = { x: x + dx1 * size + dx2 * size, y: y + dy1 * size + dy2 * size };
  const c = { x: x + dx2 * size, y: y + dy2 * size };
  return (
    <polyline
      points={`${a.x},${a.y} ${b.x},${b.y} ${c.x},${c.y}`}
      fill="none"
      className="stroke-foreground"
      strokeWidth={1.5}
    />
  );
}

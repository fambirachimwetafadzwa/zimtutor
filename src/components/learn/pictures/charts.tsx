import type { StemData } from "@/lib/questions/types";
import { Drawing, Text, fromNorth, paletteAt, plainNumber } from "./common";

type Of<K extends StemData["kind"]> = Extract<StemData, { kind: K }>;

// A chart is announced as "a chart", never by its kind: "What kind of graph is this?" is a question.

/** A label split over at most two lines so it fits under a bar. */
function wrap(label: string, max: number): string[] {
  if (label.length <= max) return [label];
  const words = label.split(" ");
  const first: string[] = [];
  let i = 0;
  while (i < words.length && [...first, words[i]!].join(" ").length <= max) first.push(words[i++]!);
  if (first.length === 0) return [`${label.slice(0, max - 1)}…`];
  const rest = words.slice(i).join(" ");
  return [first.join(" "), rest.length > max ? `${rest.slice(0, max - 1)}…` : rest];
}

function ticks(max: number, step: number): number[] {
  const out: number[] = [];
  for (let v = 0; v <= max + step / 1e6 && out.length < 60; v += step)
    out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

export function TablePicture({ data }: { data: Of<"table"> }) {
  return (
    // a table wider than a phone scrolls sideways; a keyboard has to be able to reach it to scroll it
    <div
      role="region"
      aria-label={data.caption ?? "Table"}
      tabIndex={0}
      className="max-w-full overflow-x-auto"
    >
      <table className="my-2 border-collapse text-base">
        {data.caption ? (
          <caption className="pb-2 text-left font-semibold">{data.caption}</caption>
        ) : null}
        <thead>
          <tr>
            {data.headers.map((h, i) => (
              <th
                key={i}
                scope="col"
                className="border border-border bg-background px-3 py-1.5 text-left"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row, r) => (
            <tr key={r}>
              {row.map((cell, c) => (
                <td key={c} className="border border-border px-3 py-1.5">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function BarChartPicture({ data }: { data: Of<"bar-chart"> }) {
  const horizontal = data.orientation === "horizontal";
  const W = 420;
  const H = horizontal ? 290 : 268;
  const left = horizontal ? 96 : 56;
  const right = W - 14;
  const top = 38;
  const bottom = horizontal ? 238 : 214;
  const plotW = right - left;
  const plotH = bottom - top;
  const n = data.bars.length;
  const detail = `${data.title}. ${data.bars.map((b) => `${b.label}: ${plainNumber(b.value)}`).join("; ")}.`;
  const grid = ticks(data.max, data.step);
  const valueAt = (v: number) => Math.min(Math.max(v, 0), data.max) / data.max;

  return (
    <Drawing viewBox={`0 0 ${W} ${H}`} label={`A chart: ${data.title}`} detail={detail}>
      <Text x={W / 2} y={18} size={14} weight={700}>
        {data.title}
      </Text>
      {grid.map((v) =>
        horizontal ? (
          <g key={v}>
            <line
              x1={left + valueAt(v) * plotW}
              y1={top}
              x2={left + valueAt(v) * plotW}
              y2={bottom}
              className="stroke-border"
              strokeWidth={1}
            />
            <Text x={left + valueAt(v) * plotW} y={bottom + 14} size={12}>
              {plainNumber(v)}
            </Text>
          </g>
        ) : (
          <g key={v}>
            <line
              x1={left}
              y1={bottom - valueAt(v) * plotH}
              x2={right}
              y2={bottom - valueAt(v) * plotH}
              className="stroke-border"
              strokeWidth={1}
            />
            <Text x={left - 6} y={bottom - valueAt(v) * plotH + 4} size={12} anchor="end">
              {plainNumber(v)}
            </Text>
          </g>
        ),
      )}
      {data.bars.map((bar, i) => {
        if (horizontal) {
          const slot = plotH / n;
          const bh = slot * 0.62;
          const y = top + slot * i + (slot - bh) / 2;
          const lines = wrap(bar.label, 12);
          return (
            <g key={i}>
              <rect
                x={left}
                y={y}
                width={valueAt(bar.value) * plotW}
                height={bh}
                className="fill-brand"
              />
              {lines.map((line, k) => (
                <Text
                  key={k}
                  x={left - 6}
                  y={y + bh / 2 + 4 + (k - (lines.length - 1) / 2) * 12}
                  size={12}
                  anchor="end"
                >
                  {line}
                </Text>
              ))}
            </g>
          );
        }
        const slot = plotW / n;
        const bw = slot * 0.62;
        const x = left + slot * i + (slot - bw) / 2;
        const h = valueAt(bar.value) * plotH;
        const lines = wrap(bar.label, n > 6 ? 7 : 11);
        return (
          <g key={i}>
            <rect x={x} y={bottom - h} width={bw} height={h} className="fill-brand" />
            {lines.map((line, k) => (
              <Text key={k} x={x + bw / 2} y={bottom + 15 + k * 12} size={12}>
                {line}
              </Text>
            ))}
          </g>
        );
      })}
      <line
        x1={left}
        y1={top}
        x2={left}
        y2={bottom}
        className="stroke-foreground"
        strokeWidth={1.5}
      />
      <line
        x1={left}
        y1={bottom}
        x2={right}
        y2={bottom}
        className="stroke-foreground"
        strokeWidth={1.5}
      />
      {horizontal ? (
        <>
          <Text x={W / 2} y={H - 8} size={12} weight={600}>
            {data.yLabel}
          </Text>
          <Text x={14} y={(top + bottom) / 2} size={12} weight={600} rotate={-90}>
            {data.xLabel}
          </Text>
        </>
      ) : (
        <>
          <Text x={(left + right) / 2} y={H - 8} size={12} weight={600}>
            {data.xLabel}
          </Text>
          <Text x={14} y={(top + bottom) / 2} size={12} weight={600} rotate={-90}>
            {data.yLabel}
          </Text>
        </>
      )}
    </Drawing>
  );
}

export function LineGraphPicture({ data }: { data: Of<"line-graph"> }) {
  const W = 420;
  const H = 268;
  const left = 56;
  const right = W - 16;
  const top = 38;
  const bottom = 214;
  const plotW = right - left;
  const plotH = bottom - top;
  const n = data.points.length;
  const xAt = (i: number) => left + (n === 1 ? plotW / 2 : (plotW * (i + 0.5)) / n);
  const yAt = (v: number) => bottom - (Math.min(Math.max(v, 0), data.max) / data.max) * plotH;
  const detail = `${data.title}. ${data.points.map((p) => `${p.label}: ${plainNumber(p.value)}`).join("; ")}.`;
  return (
    <Drawing viewBox={`0 0 ${W} ${H}`} label={`A chart: ${data.title}`} detail={detail}>
      <Text x={W / 2} y={18} size={14} weight={700}>
        {data.title}
      </Text>
      {ticks(data.max, data.step).map((v) => (
        <g key={v}>
          <line
            x1={left}
            y1={yAt(v)}
            x2={right}
            y2={yAt(v)}
            className="stroke-border"
            strokeWidth={1}
          />
          <Text x={left - 6} y={yAt(v) + 4} size={12} anchor="end">
            {plainNumber(v)}
          </Text>
        </g>
      ))}
      <polyline
        points={data.points.map((p, i) => `${xAt(i)},${yAt(p.value)}`).join(" ")}
        fill="none"
        className="stroke-brand"
        strokeWidth={2.5}
      />
      {data.points.map((p, i) => (
        <g key={i}>
          <circle cx={xAt(i)} cy={yAt(p.value)} r={4.5} className="fill-brand" />
          {wrap(p.label, n > 6 ? 7 : 11).map((line, k) => (
            <Text key={k} x={xAt(i)} y={bottom + 15 + k * 12} size={12}>
              {line}
            </Text>
          ))}
        </g>
      ))}
      <line
        x1={left}
        y1={top}
        x2={left}
        y2={bottom}
        className="stroke-foreground"
        strokeWidth={1.5}
      />
      <line
        x1={left}
        y1={bottom}
        x2={right}
        y2={bottom}
        className="stroke-foreground"
        strokeWidth={1.5}
      />
      <Text x={(left + right) / 2} y={H - 8} size={12} weight={600}>
        {data.xLabel}
      </Text>
      <Text x={14} y={(top + bottom) / 2} size={12} weight={600} rotate={-90}>
        {data.yLabel}
      </Text>
    </Drawing>
  );
}

export function PictographPicture({ data }: { data: Of<"pictograph"> }) {
  const detail = `${data.title}. Each ${data.symbol} stands for ${data.each}. ${data.rows.map((r) => `${r.label}: ${r.count} symbols`).join("; ")}.`;
  return (
    <figure
      className="my-2 max-w-md rounded-xl border border-border bg-surface p-3"
      aria-label={detail}
    >
      <figcaption className="pb-2 font-semibold">{data.title}</figcaption>
      <ul className="flex flex-col gap-1.5">
        {data.rows.map((row, i) => (
          <li key={i} className="flex items-center gap-3">
            <span className="w-28 shrink-0 text-base">{row.label}</span>
            <span aria-hidden="true" className="flex flex-wrap gap-0.5 text-xl leading-none">
              {Array.from({ length: row.count }, (_, k) => (
                <span key={k}>{data.symbol}</span>
              ))}
            </span>
          </li>
        ))}
      </ul>
      <p className="pt-2 text-base font-semibold">
        Key: each {data.symbol} stands for {data.each}
      </p>
    </figure>
  );
}

export function TallyPicture({ data }: { data: Of<"tally"> }) {
  const W = 430;
  const rowH = 38;
  const H = 34 + data.rows.length * rowH;
  const detail = `${data.title}. ${data.rows.map((r) => `${r.label}: ${r.count}`).join("; ")}.`;
  return (
    <Drawing viewBox={`0 0 ${W} ${H}`} label={`A chart: ${data.title}`} detail={detail}>
      <Text x={W / 2} y={18} size={14} weight={700}>
        {data.title}
      </Text>
      {data.rows.map((row, i) => {
        const y = 34 + i * rowH;
        const groups = Math.floor(row.count / 5);
        const rest = row.count % 5;
        const marks: React.ReactNode[] = [];
        const baseX = 120;
        for (let g = 0; g < groups; g++) {
          const gx = baseX + g * 38;
          for (let k = 0; k < 4; k++)
            marks.push(
              <line
                key={`${g}-${k}`}
                x1={gx + k * 7}
                y1={y + 6}
                x2={gx + k * 7}
                y2={y + 28}
                className="stroke-foreground"
                strokeWidth={2}
              />,
            );
          marks.push(
            <line
              key={`${g}-d`}
              x1={gx - 4}
              y1={y + 24}
              x2={gx + 25}
              y2={y + 10}
              className="stroke-foreground"
              strokeWidth={2}
            />,
          );
        }
        const rx = baseX + groups * 38;
        for (let k = 0; k < rest; k++)
          marks.push(
            <line
              key={`r-${k}`}
              x1={rx + k * 7}
              y1={y + 6}
              x2={rx + k * 7}
              y2={y + 28}
              className="stroke-foreground"
              strokeWidth={2}
            />,
          );
        return (
          <g key={i}>
            <Text x={8} y={y + 22} size={13} anchor="start">
              {row.label}
            </Text>
            {marks}
            <line
              x1={8}
              y1={y + rowH - 2}
              x2={W - 8}
              y2={y + rowH - 2}
              className="stroke-border"
              strokeWidth={1}
            />
          </g>
        );
      })}
    </Drawing>
  );
}

export function PieChartPicture({ data }: { data: Of<"pie-chart"> }) {
  const W = 430;
  const H = 280;
  const cx = 130;
  const cy = 150;
  const r = 100;
  const total = data.slices.reduce((a, s) => a + s.value, 0);
  const text = (value: number): string => {
    switch (data.valueLabel) {
      case "percent":
        return `${plainNumber((value / total) * 100)}%`;
      case "degrees":
        return `${plainNumber((value / total) * 360)}°`;
      case "count":
        return plainNumber(value);
      case "none":
        return "";
    }
  };
  const sweeps = data.slices.map((s) => (s.value / total) * 360);
  const starts = sweeps.map((_, i) => sweeps.slice(0, i).reduce((a, b) => a + b, 0));
  const detail = `${data.title}. ${data.slices.map((s) => `${s.label}${data.valueLabel === "none" ? "" : `: ${text(s.value)}`}`).join("; ")}.`;
  return (
    <Drawing viewBox={`0 0 ${W} ${H}`} label={`A chart: ${data.title}`} detail={detail}>
      <Text x={W / 2} y={18} size={14} weight={700}>
        {data.title}
      </Text>
      {data.slices.map((s, i) => {
        const sweep = sweeps[i]!;
        const a0 = starts[i]!;
        const a1 = a0 + sweep;
        const p0 = fromNorth(cx, cy, r, a0);
        const p1 = fromNorth(cx, cy, r, a1);
        const large = sweep > 180 ? 1 : 0;
        const mid = fromNorth(cx, cy, r * (sweep < 30 ? 1.18 : 0.62), (a0 + a1) / 2);
        const path =
          data.slices.length === 1
            ? ""
            : `M ${cx} ${cy} L ${p0.x} ${p0.y} A ${r} ${r} 0 ${large} 1 ${p1.x} ${p1.y} Z`;
        return (
          <g key={i}>
            <path d={path} fill={paletteAt(i).fill} stroke="#fff" strokeWidth={2} />
            {data.valueLabel !== "none" ? (
              <text
                x={mid.x}
                y={mid.y + 4}
                fontSize={12}
                fontWeight={700}
                textAnchor="middle"
                fill={sweep < 30 ? "#1b2a2f" : paletteAt(i).ink}
              >
                {text(s.value)}
              </text>
            ) : null}
          </g>
        );
      })}
      {data.slices.map((s, i) => (
        <g key={i}>
          <rect x={262} y={64 + i * 24} width={14} height={14} fill={paletteAt(i).fill} />
          <Text x={284} y={76 + i * 24} size={13} anchor="start">
            {s.label}
          </Text>
        </g>
      ))}
    </Drawing>
  );
}

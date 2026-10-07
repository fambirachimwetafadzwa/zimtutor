import { SOURCE_TYPE_INFO, STATUS_LABELS, type SourceType } from "@/lib/supplemental/rules";

const TONES = {
  official: "border-emerald-300 bg-emerald-50 text-emerald-900",
  supplemental: "border-sky-300 bg-sky-50 text-sky-900",
  ai: "border-violet-300 bg-violet-50 text-violet-900",
  unverified: "border-amber-300 bg-amber-50 text-amber-900",
} as const;

const base =
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-sm font-semibold whitespace-nowrap";

/** The five content categories are always shown with their own label AND colour, so they cannot be confused. */
export function SourceTypeBadge({ type }: { type: string }) {
  const info = SOURCE_TYPE_INFO[type as SourceType];
  if (!info) {
    return (
      <span className={`${base} border-red-300 bg-red-50 text-red-900`}>Unknown label: {type}</span>
    );
  }
  return (
    <span className={`${base} ${TONES[info.tone]}`} title={info.description}>
      {info.label}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const label = STATUS_LABELS[status as keyof typeof STATUS_LABELS] ?? status;
  const tone =
    status === "VERIFIED_FROM_SOURCE" || status === "ADMIN_REVIEWED"
      ? "border-emerald-300 bg-emerald-50 text-emerald-900"
      : status === "REJECTED"
        ? "border-red-300 bg-red-50 text-red-900"
        : "border-amber-300 bg-amber-50 text-amber-900";
  return <span className={`${base} ${tone}`}>{label}</span>;
}

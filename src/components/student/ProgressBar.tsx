/** A bar with a text equivalent. `label` names what it measures ("Number, mastery"). */
export function ProgressBar({
  percent,
  label,
  tone = "brand",
}: {
  percent: number;
  label: string;
  tone?: "brand" | "accent";
}) {
  const value = Math.max(0, Math.min(100, Math.round(percent)));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
      aria-valuetext={`${value} percent`}
      className="h-3 w-full overflow-hidden rounded-full bg-border"
    >
      <div
        className={`h-full rounded-full ${tone === "accent" ? "bg-accent" : "bg-brand"}`}
        style={{ width: `${value}%` }}
      />
    </div>
  );
}

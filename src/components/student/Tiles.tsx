import type { MasteryTiles } from "@/lib/student/dashboard";

/** How many goals are where. The four always add up to the total. */
export function Tiles({
  tiles,
  note = `${tiles.total} goals in your grade that ZimTutor can practise with you.`,
}: {
  tiles: MasteryTiles;
  /** The line under the tiles. */
  note?: string;
}) {
  const items = [
    { label: "Mastered", value: tiles.mastered, style: "border-emerald-300 bg-emerald-50" },
    { label: "Working on", value: tiles.inProgress, style: "border-sky-300 bg-sky-50" },
    { label: "Time to review", value: tiles.review, style: "border-amber-300 bg-amber-50" },
    { label: "Not started", value: tiles.notStarted, style: "border-border bg-surface" },
  ];
  return (
    <section aria-label="Your goals at a glance" className="flex flex-col gap-2">
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {items.map((item) => (
          <li key={item.label} className={`rounded-2xl border p-4 ${item.style}`}>
            <p className="text-3xl font-extrabold">{item.value}</p>
            <p className="text-base font-semibold">{item.label}</p>
          </li>
        ))}
      </ul>
      <p className="text-sm text-muted">{note}</p>
    </section>
  );
}

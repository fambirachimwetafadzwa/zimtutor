/**
 * Bullet lists from the syllabus's competency-matrix cells. The syllabus marks teaching constraints
 * with "NB" (for example "NB: teachers should not teach the term commutative law"): they are shown
 * with their own style so a teacher or administrator cannot miss them.
 */
export const isTeachingNote = (text: string) => /^NB\b/i.test(text.trim());

export function RowItems({
  items,
  empty = "—",
}: {
  items: Array<{ id: string; text: string }>;
  empty?: string;
}) {
  if (items.length === 0) return <p className="text-muted">{empty}</p>;
  return (
    <ul className="flex list-disc flex-col gap-1.5 pl-5">
      {items.map((item) => (
        <li
          key={item.id}
          className={isTeachingNote(item.text) ? "font-semibold text-amber-900" : undefined}
        >
          {item.text}
        </li>
      ))}
    </ul>
  );
}

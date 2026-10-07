/** "Syllabus page 33 (PDF page 37)" — the printed label and the PDF page are different numbers. */
export function pageCitation(page: number, label: string | null, end?: number | null): string {
  const pdf = end && end !== page ? `PDF pages ${page}–${end}` : `PDF page ${page}`;
  return label ? `Syllabus page ${label} (${pdf})` : pdf;
}

export function Citation({
  page,
  label,
  end,
  className = "",
}: {
  page: number;
  label: string | null;
  end?: number | null;
  className?: string;
}) {
  return (
    <span className={`text-sm text-muted ${className}`}>{pageCitation(page, label, end)}</span>
  );
}

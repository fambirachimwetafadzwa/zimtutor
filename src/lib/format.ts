/**
 * Text for children's screens.
 *
 * The syllabus writes large numbers in groups of three digits separated by a space ("4 305", "100 000").
 * A line must never break inside a number, so the space between the groups becomes a non-breaking
 * space (U+00A0). Built from its code point: an invisible character must not be typed into source.
 */
const NO_BREAK_SPACE = String.fromCharCode(0xa0);

export function keepNumbersTogether(text: string): string {
  return text.replace(/(?<=\d) (?=\d{3}(?!\d))/g, NO_BREAK_SPACE);
}

/** "8 Oct": a day as people in Zimbabwe write it, whatever time zone the server runs in. */
export function formatDay(iso: string | null): string {
  return formatIn({ day: "numeric", month: "short" }, iso);
}

/** "8 Oct 2026": a date in Zimbabwe, whatever time zone the server runs in. */
export function formatDate(iso: string | null): string {
  return formatIn({ day: "numeric", month: "short", year: "numeric" }, iso);
}

/**
 * "8 Oct 2026, 11:17": a moment in Zimbabwe time (UTC+2, no daylight saving). Screens that show
 * the same moment must show the same time, so none of them may leave the zone to the server.
 */
export function formatDateTime(iso: string | null): string {
  return formatIn(
    { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" },
    iso,
  );
}

function formatIn(options: Intl.DateTimeFormatOptions, iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", { ...options, timeZone: "Africa/Harare" }).format(date);
}

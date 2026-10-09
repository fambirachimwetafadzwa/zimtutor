import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime, formatDay } from "@/lib/format";

describe("dates are shown in Zimbabwe time, whatever zone the server runs in", () => {
  // 09:17 UTC is 11:17 in Zimbabwe (UTC+2, no daylight saving).
  it("shows a moment as Zimbabwe reads it", () => {
    expect(formatDateTime("2026-10-09T09:17:01Z")).toBe("9 Oct 2026, 11:17");
  });

  it("shows the same moment the same way on every screen", () => {
    const iso = "2026-10-09T09:17:29+00:00";
    expect(formatDateTime(iso)).toBe(formatDateTime("2026-10-09T11:17:29+02:00"));
  });

  it("puts a late-evening UTC moment on the next day in Zimbabwe", () => {
    expect(formatDate("2026-10-08T23:30:00Z")).toBe("9 Oct 2026");
    expect(formatDay("2026-10-08T23:30:00Z")).toBe("9 Oct");
  });

  it("shows nothing for a missing or unreadable value", () => {
    for (const bad of [null, "", "not a date"]) {
      expect(formatDay(bad)).toBe("");
      expect(formatDate(bad)).toBe("");
      expect(formatDateTime(bad)).toBe("");
    }
  });
});

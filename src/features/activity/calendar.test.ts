import { describe, expect, it } from "vitest";
import { adjacentMonth, calendarDay, calendarMonth, monthDays, moveCalendarDay } from "./calendar.ts";

describe("record calendar civil dates", () => {
  it("pads weekdays correctly and includes leap days without adjacent-month events", () => {
    const days = monthDays("2024-02");
    expect(days.slice(0, 4)).toEqual([null, null, null, null]);
    expect(days.filter(Boolean)).toHaveLength(29);
    expect(days).toContain("2024-02-29");
    expect(monthDays("2026-10")[4]).toBe("2026-10-01");
  });
  it("validates untrusted URL state and crosses month/year edges", () => {
    expect(calendarMonth("2026-13", "2026-10")).toBe("2026-10");
    expect(calendarDay("2025-02-29", "2025-02")).toBeNull();
    expect(calendarDay("2026-11-01", "2026-10")).toBeNull();
    expect(adjacentMonth("2026-12", 1)).toBe("2027-01");
    expect(moveCalendarDay("2024-02-28", 1)).toBe("2024-02-29");
    expect(moveCalendarDay("2024-02-29", 1)).toBe("2024-03-01");
    expect(adjacentMonth("9999-12", 1)).toBeNull();
  });
});

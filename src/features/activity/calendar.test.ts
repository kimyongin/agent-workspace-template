import { expect, it } from "vitest";
import { calendarDay, calendarMonth } from "./calendar.ts";
it("기록 달력 URL은 유효한 업무 날짜와 월만 받아들인다", () => {
  expect(calendarMonth("2026-13", "2026-10")).toBe("2026-10");
  expect(calendarMonth("0000-01", "2026-10")).toBe("2026-10");
  expect(calendarMonth("9999-12", "2026-10")).toBe("9999-12");
  expect(calendarDay("2025-02-29", "2025-02")).toBeNull();
  expect(calendarDay("2024-02-29", "2024-02")).toBe("2024-02-29");
  expect(calendarDay("2026-11-01", "2026-10")).toBeNull();
  expect(calendarDay("0000-01-01", "0000-01")).toBeNull();
});

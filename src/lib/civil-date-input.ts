import { isoDate } from "@contracts/common.ts";

/** Editable civil dates retain the native input's 1–9999 year range. */
export function isCivilDateInput(value: string): boolean {
  return !value.startsWith("0000-") && isoDate.safeParse(value).success;
}

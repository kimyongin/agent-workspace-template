/** Account display preference; scheduling time zones remain owned by each task. */
export const browserTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
export function timezonePreference(value: unknown): string | null {
  if (typeof value !== "string" || !value || /^[+-]/.test(value)) return null;
  try { return new Intl.DateTimeFormat("en", { timeZone: value }).resolvedOptions().timeZone; }
  catch { return null; }
}
export function timezoneOptions(current: string | null) {
  return [...new Set([browserTimezone(), "UTC", ...(current ? [current] : []), ...Intl.supportedValuesOf("timeZone")])].sort();
}

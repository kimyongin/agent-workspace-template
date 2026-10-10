import { z } from "zod";
/** Existing persisted UUIDs remain readable; newly allocated IDs use the dated form. */
export const dataId = z.union([
  z.uuid(),
  z.string().regex(/^\d{8}-[0-9A-Z]{8}$/).refine((value) => {
    const date = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
    const parsed = new Date(`${date}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
  }),
]);
/** Candidate generation for isolated adapters; production allocation reserves IDs in PostgreSQL. */
export function generateDataId(now = new Date()): string {
  const prefix = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now).replaceAll("-", "");
  const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let suffix = "";
  while (suffix.length < 8) {
    for (const byte of crypto.getRandomValues(new Uint8Array(16))) {
      if (byte < 252) suffix += alphabet[byte % 36];
      if (suffix.length === 8) break;
    }
  }
  return `${prefix}-${suffix}`;
}

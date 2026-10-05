import type { ChangeMetadata } from "../../contracts/change.ts";
import type { ChangeMemo } from "../../contracts/change.ts";
export interface ChangeInput {
  target_kind: ChangeMetadata["target_kind"];
  action: ChangeMetadata["action"];
  before: object | null;
  after: object | null;
  change_note?: string;
  change_memo?: ChangeMemo;
}
export interface ChangeStore {
  appendChange(input: ChangeInput): Promise<void>;
}
/** Metadata and version changes alone are not a user content change. */
export function changed(old: object, patch: object): boolean {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, v]) => [key, canonical(v)]),
      );
    }
    return value;
  };
  const comparable = (key: string, value: unknown) =>
    canonical(
      ["tag_ids", "applied_principle_ids", "entity_ids"].includes(key) && Array.isArray(value)
        ? [...value].sort()
        : value,
    );
  return Object.entries(patch).some(([key, value]) =>
    value !== undefined &&
    JSON.stringify(comparable(key, (old as Record<string, unknown>)[key])) !== JSON.stringify(comparable(key, value))
  );
}

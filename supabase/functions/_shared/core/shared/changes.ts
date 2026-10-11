import type { RequestStore } from "./request.ts";
import type { ChangeMetadata } from "../../contracts/change.ts";
import type { EntityContext } from "../../contracts/entity-links.ts";
import type { Recurrence } from "../../contracts/task.ts";

/** Facts used by the default memo, never a complete DTO or historical snapshot. */
export interface ChangeFacts {
  source?: string;
  external_id?: string;
  prop1?: string;
  prop2?: number | null;
  prop3?: string | null;
  prop4?: "a" | "b" | "c";
  title?: string;
  body?: string;
  status?: "open" | "done" | "active" | "stopped";
  kind?: "once" | "recurring";
  due_on?: string | null;
  recurrence?: Recurrence | null;
  timezone?: string | null;
  tag_ids?: string[];
  entity_ids?: string[];
  pauses?: { stopped_on: string; resumed_on: string | null }[];
}

/** Identity and selected entity context of the event, including a deleted target. */
export interface ChangeTarget {
  id: string;
  title: string;
  entity_ids: string[];
  entity_context: EntityContext[];
}
export interface ChangeInput {
  target_kind: ChangeMetadata["target_kind"];
  target: ChangeTarget;
  action: ChangeMetadata["action"];
  before: ChangeFacts | null;
  after: ChangeFacts | null;
  change_note?: string;
  change_tag_ids?: string[];
}
export interface ChangeStore extends RequestStore {
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
      ["tag_ids", "entity_ids"].includes(key) && Array.isArray(value) ? [...value].sort() : value,
    );
  return Object.entries(patch).some(([key, value]) =>
    value !== undefined &&
    JSON.stringify(comparable(key, (old as Record<string, unknown>)[key])) !== JSON.stringify(comparable(key, value))
  );
}

import { decodeIdentifierReference } from "./entity-identifiers.ts";
import { z } from "zod";

export const entityTypeKey = z.string().uuid().transform((v) => v.toLowerCase());
export { identifierReference as entityReferenceId } from "./entity-identifiers.ts";
import { identifierReference as entityReferenceId } from "./entity-identifiers.ts";
export const entityReferenceIds = z.array(entityReferenceId).max(100).refine(
  (ids) => new Set(ids).size === ids.length,
  {
    message: "중복된 엔터티 참조가 있습니다",
  },
);
export function entityPath(id: string): string {
  return `/entities/${encodeURIComponent(id)}`;
}
export function entityIdentityLabel(value: { id: string; identity_label?: string }): string {
  if (value.identity_label) return value.identity_label;
  const pair = decodeIdentifierReference(value.id);
  return `${pair.kind_id.slice(0, 8)} · ${pair.raw}`;
}

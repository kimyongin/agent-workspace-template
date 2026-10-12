import { z } from "zod";
import { businessMeta } from "./change.ts";
import { expectedVersion, page, pageInput } from "./common.ts";
import { entityReferenceId } from "./entity-identity.ts";
import { entitySummary } from "./entity.ts";

/** UTF-8 byte order equals Unicode scalar order; JS UTF-16 order does not. */
export function compareEntityIds(a: string, b: string): number {
  const left = Array.from(a, (c) => c.codePointAt(0)!), right = Array.from(b, (c) => c.codePointAt(0)!);
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    if (left[i] !== right[i]) return left[i] - right[i];
  }
  return left.length - right.length;
}
export function normalizePair(
  entity_id: string,
  other_id: string,
  expected_version: number,
  expected_other_version: number,
) {
  return compareEntityIds(entity_id, other_id) <= 0
    ? { entity_id, other_id, expected_version, expected_other_version }
    : {
      entity_id: other_id,
      other_id: entity_id,
      expected_version: expected_other_version,
      expected_other_version: expected_version,
    };
}
/** Bound includes preserved links to deleted/archived endpoints. */
export const ENTITY_PAIR_LIMIT = 100;
export const entityPairWrite = z.strictObject({
  other_id: entityReferenceId,
  expected_version: expectedVersion,
  expected_other_version: expectedVersion,
  ...businessMeta,
});
export const entityPairDelete = entityPairWrite.omit({ other_id: true });
export const entityPairQuery = z.strictObject({ ...pageInput, cursor: z.string().min(1).max(2000).optional() });
export const entityPairResult = z.object({
  changed: z.boolean(),
  pair: z.object({ entity_id: entityReferenceId, other_id: entityReferenceId }),
  endpoint_versions: z.array(z.object({ id: entityReferenceId, version: expectedVersion })).length(2),
});
export const entityLinkPage = page(entitySummary);
export type EntityPairWrite = z.infer<typeof entityPairWrite>;
export type EntityPairQuery = z.infer<typeof entityPairQuery>;

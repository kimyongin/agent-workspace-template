import { z } from "zod";
import { relationSide } from "./entity-relation.ts";
import { entityReferenceId } from "./entity-identity.ts";
import { businessMeta } from "./change.ts";
import { expectedVersion, pageInput, text } from "./common.ts";
export const relationLocation = z.strictObject({
  definition_id: z.string().uuid(),
  side: relationSide,
  origin_id: entityReferenceId,
});
export const relationLinkQuery = relationLocation.extend({
  ...pageInput,
  cursor: z.string().min(1).max(2000).optional(),
  q: text(0, 100).default(""),
});
export const relationLinkWrite = relationLocation.extend({
  other_id: entityReferenceId,
  expected_definition_version: expectedVersion,
  expected_version: expectedVersion,
  expected_other_version: expectedVersion,
  ...businessMeta,
});
export const relationReplaceWrite = relationLinkWrite.extend({
  previous_other_id: entityReferenceId.nullable(),
  expected_previous_version: expectedVersion.nullable(),
}).superRefine((v, c) => {
  if ((v.previous_other_id === null) !== (v.expected_previous_version === null)) {
    c.addIssue({
      code: "custom",
      path: ["expected_previous_version"],
      message: "이전 자료 ID와 버전을 함께 지정하세요",
    });
  }
});
export type RelationLocation = z.infer<typeof relationLocation>;
export type RelationLinkQuery = z.infer<typeof relationLinkQuery>;
export type RelationLinkWrite = z.infer<typeof relationLinkWrite>;
export type RelationReplaceWrite = z.infer<typeof relationReplaceWrite>;
export interface RelationMutationResult {
  changed: boolean;
  definition_id: string;
  side: 0 | 1;
  origin_id: string;
  other_id: string;
  endpoint_versions: { id: string; version: number }[];
}

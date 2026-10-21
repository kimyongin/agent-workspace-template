import { z } from "zod";
import { entityCreate, entityRestore } from "./entity.ts";
import { entityReferenceId } from "./entity-identity.ts";
import { relationLocation } from "./entity-relation-links.ts";
import { expectedVersion } from "./common.ts";
import { businessMeta } from "./change.ts";
export const createAndLinkInput = relationLocation.extend({
  expected_definition_version: expectedVersion,
  expected_version: expectedVersion,
  previous_other_id: entityReferenceId.nullable(),
  expected_previous_version: expectedVersion.nullable(),
  entity: z.discriminatedUnion("action", [
    entityCreate.extend({ action: z.literal("create") }),
    entityRestore.extend({ action: z.literal("restore"), id: entityReferenceId }),
  ]),
  ...businessMeta,
}).superRefine((v, c) => {
  if ((v.previous_other_id === null) !== (v.expected_previous_version === null)) {
    c.addIssue({
      code: "custom",
      path: ["expected_previous_version"],
      message: "검토한 이전 자료 ID와 버전을 함께 지정하세요",
    });
  }
});
export type CreateAndLinkInput = z.infer<typeof createAndLinkInput>;

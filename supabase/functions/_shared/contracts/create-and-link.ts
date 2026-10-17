import { z } from "zod";
import { entityCreate } from "./entity.ts";
import { entityReferenceId } from "./entity-identity.ts";
import { relationLocation } from "./entity-relation-links.ts";
import { expectedVersion } from "./common.ts";
import { businessMeta } from "./change.ts";
export const createAndLinkInput = relationLocation.extend({
  expected_definition_version: expectedVersion,
  expected_version: expectedVersion,
  previous_other_id: entityReferenceId.nullable(),
  expected_previous_version: expectedVersion.nullable(),
  entity: entityCreate,
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

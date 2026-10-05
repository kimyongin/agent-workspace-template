import { z } from "zod";
import { entityCreate, entityUpdate } from "./entity.ts";
import { expectedVersion, id } from "./common.ts";
export const entityChangePreview = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("create"), input: entityCreate }),
  z.strictObject({ action: z.literal("update"), id, input: entityUpdate }),
  z.strictObject({ action: z.literal("delete"), id, input: z.strictObject({ expected_version: expectedVersion }) }),
]);
export type EntityChangePreview = z.infer<typeof entityChangePreview>;

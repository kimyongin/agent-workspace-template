import { z } from "zod";
import { expectedVersion, id, isoDateTime, pageInput, requestId, text } from "./common.ts";
export const tagCreate = z.strictObject({ name: text(1, 30), request_id: requestId.optional() });
export const tagRename = z.strictObject({ name: text(1, 30), expected_version: expectedVersion });
export const tagListQuery = z.strictObject({ ...pageInput });
export const tagResult = z.object({
  id,
  name: z.string(),
  version: z.number().int(),
  created_at: isoDateTime,
  updated_at: isoDateTime,
});
export type TagResult = z.infer<typeof tagResult>;
export const tagLabels = { name: "태그 이름" };

import { z } from "zod";
import { expectedVersion, id, isoDateTime, pageInput, referenceIds, requestId, text } from "./common.ts";
export const tagIds = referenceIds.max(10, { message: "태그는 최대 10개입니다" });
/** GET accepts comma-separated IDs; MCP/POST accepts arrays. OR before pagination. */
export const tagFilterIds = tagIds.transform((ids) => [...ids].sort());
export const tagScope = z.enum(["entity", "activity"]);
export const tagCreate = z.strictObject({
  scope: tagScope.default("activity"),
  name: text(1, 30),
  request_id: requestId.optional(),
});
export const tagRename = z.strictObject({ name: text(1, 30), expected_version: expectedVersion });
export const tagListQuery = z.strictObject({ scope: tagScope.default("activity"), ...pageInput });
export const tagResult = z.object({
  scope: tagScope,
  id,
  name: z.string(),
  version: z.number().int(),
  created_at: isoDateTime,
  updated_at: isoDateTime,
});
export type TagResult = z.infer<typeof tagResult>;
export const tagLabels = { name: "태그 이름" };

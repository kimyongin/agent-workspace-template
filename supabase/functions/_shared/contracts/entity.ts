import { z } from "zod";
import { businessMeta } from "./change.ts";
import { tagIds } from "./tag.ts";
import { expectedVersion, id, isoDate, isoDateTime, page, pageInput, text } from "./common.ts";

const date = isoDate.refine((v) => v >= "0001-01-01", { message: "1년 이후의 날짜를 쓰세요" });
const properties = {
  prop1: text(1, 100),
  prop2: z.number().int().min(0).max(1_000_000).nullable(),
  prop3: date.nullable(),
  prop4: z.enum(["a", "b", "c"]),
};
export const entityCreate = z.strictObject({
  id,
  ...businessMeta,
  tag_ids: tagIds.optional(),
  ...properties,
  prop2: properties.prop2.default(null),
  prop3: properties.prop3.default(null),
  prop4: properties.prop4.default("a"),
});
export const entityUpdate = z.strictObject({
  ...businessMeta,
  tag_ids: tagIds.optional(),
  prop1: properties.prop1.optional(),
  prop2: properties.prop2.optional(),
  prop3: properties.prop3.optional(),
  prop4: properties.prop4.optional(),
  expected_version: expectedVersion,
}).refine(
  (v) => Object.keys(v).some((k) => !["expected_version", "change_note", "change_memo"].includes(k)),
  {
    message: "바꿀 필드가 없습니다",
  },
);
export const entityListQuery = z.strictObject({
  tag_id: id.optional(),
  ...pageInput,
  cursor: z.string().min(1).max(2000).optional(),
  keyword: text(1, 100).optional(),
  prop3_from: date.optional(),
  prop3_to: date.optional(),
  prop4: properties.prop4.optional(),
  sort: z.enum(["updated_at", "prop1", "prop2", "prop3"]).default("updated_at"),
}).refine((v) => !v.prop3_from || !v.prop3_to || v.prop3_from <= v.prop3_to, {
  message: "시작 날짜는 끝 날짜보다 늦을 수 없습니다",
  path: ["prop3_from"],
});
export const entityResult = z.object({
  tag_ids: z.array(id),
  id,
  ...properties,
  version: z.number().int(),
  created_at: isoDateTime,
  updated_at: isoDateTime,
});
const related = z.object({
  count: z.number().int().nonnegative(),
  items: z.array(z.object({ id, title: z.string(), updated_at: isoDateTime })),
});
export const entityDetail = entityResult.extend({ tasks: related, records: related });
export const entityPage = page(entityResult);
export type EntityCreate = z.infer<typeof entityCreate>;
export type EntityUpdate = z.infer<typeof entityUpdate>;
export type EntityQuery = z.infer<typeof entityListQuery>;
export type EntityResult = z.infer<typeof entityResult>;
export type EntityDetail = z.infer<typeof entityDetail>;
export const entityLabels = { prop1: "속성 1", prop2: "속성 2", prop3: "속성 3", prop4: "속성 4" };

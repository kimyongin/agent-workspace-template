import { z } from "zod";
import { expectedVersion, pageInput, text } from "./common.ts";
export const relationSide = z.union([z.literal(0), z.literal(1)]);
export const relationEnd = z.strictObject({
  type_id: z.string().uuid(),
  label: text(1, 100).refine(
    (v) => !v.includes("\u0000") && !/[\uD800-\uDFFF]/u.test(v),
    "올바른 Unicode 문자열을 입력하세요",
  ),
  cardinality: z.enum(["one", "many"]),
});
export const relationEnds = z.tuple([relationEnd, relationEnd]);
export const relationDefinitionCreate = z.strictObject({ ends: relationEnds });
export const relationDefinitionUpdate = z.strictObject({
  ends: relationEnds.optional(),
  archived: z.boolean().optional(),
  expected_version: expectedVersion,
});
export const relationDefinitionDelete = z.strictObject({ expected_version: expectedVersion });
export const relationDefinitionQuery = z.strictObject({
  type_id: z.string().uuid().optional(),
  q: text(0, 100).optional(),
  archived: z.enum(["active", "archived", "all"]).default("active"),
  ...pageInput,
});
export type EntityRelationEnd = z.infer<typeof relationEnd>;
/** Index 0 and 1 identify roles, even when both ends have the same type. Cardinality belongs to the origin end. */
export interface EntityRelationDefinition {
  id: string;
  version: number;
  archived: boolean;
  ends: [EntityRelationEnd, EntityRelationEnd];
}
export interface EntityRelationDefinitionPage {
  items: EntityRelationDefinition[];
  next_cursor: string | null;
}

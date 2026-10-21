import { z } from "zod";
import { expectedVersion, text } from "./common.ts";
const sqlSafeString = z.string().refine((v) => !v.includes("\u0000") && !/[\uD800-\uDFFF]/u.test(v), {
  message: "올바른 Unicode 문자열을 입력하세요",
});
export const APP_IDENTIFIER_RULE_ID = "00000000-0000-4000-8000-000000000001";
export const issuerCode = z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/);
const label = sqlSafeString.pipe(text(1, 100));
export const issuerCreate = z.strictObject({ code: issuerCode, label });
export const issuerUpdate = z.strictObject({
  label: label.optional(),
  active: z.boolean().optional(),
  expected_version: expectedVersion,
});
export const identifierRuleCreate = z.strictObject({ label, meaning: sqlSafeString.pipe(text(1, 500)) });
export const identifierRuleUpdate = z.strictObject({
  label: label.optional(),
  meaning: sqlSafeString.pipe(text(1, 500)).optional(),
  active: z.boolean().optional(),
  expected_version: expectedVersion,
});
export interface EntityIssuer {
  code: string;
  label: string;
  active: boolean;
  system: boolean;
  version: number;
}
export interface IdentifierRule {
  id: string;
  source: string;
  label: string;
  meaning: string;
  generation: "automatic" | "direct";
  active: boolean;
  version: number;
}
/** Policy field paths carry the affected owner-scoped type, never another owner's labels. */
export const identifierDefaultFieldPath = "default_fields.";
export interface IdentifierDefaultField {
  type_id: string;
  property: string;
  label: string;
}
export const registryDelete = z.strictObject({ expected_version: expectedVersion });

/** Registry projection restricted to kinds referenced by an authorized definition. */
export interface IdentifierKindMetadata {
  id: string;
  source: string;
  label: string;
  source_label: string;
  active: boolean;
  generation: "automatic" | "direct";
  version: number;
  source_version: number;
}

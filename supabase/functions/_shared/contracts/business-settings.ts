import { z } from "zod";
import { entityIdentitySettings } from "./entity-identity.ts";
import { recordTemplates } from "./record-template.ts";

export const BUSINESS_SETTINGS_MAX_BYTES = 131072;
export const businessSettings = z.strictObject({
  record_templates: recordTemplates.optional(),
  entity_identity: entityIdentitySettings.optional(),
});
export type BusinessSettings = z.infer<typeof businessSettings>;
export const businessSettingsResult = z.object({ version: z.number().int().nonnegative(), settings: businessSettings });
export type BusinessSettingsResult = z.infer<typeof businessSettingsResult>;
export const businessSettingsUpdate = z.strictObject({
  expected_version: z.number().int().nonnegative(),
  sections: businessSettings,
}).refine((value) => Object.keys(value.sections).length > 0, { message: "저장할 설정 섹션이 없습니다" });

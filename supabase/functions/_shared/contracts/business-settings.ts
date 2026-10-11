import { z } from "zod";
import { defaultEntityIdentitySettings, entityIdentitySettings } from "./entity-identity.ts";
import { recordTemplates } from "./record-template.ts";

export const BUSINESS_SETTINGS_MAX_BYTES = 131072;
export const businessSettings = z.strictObject({
  record_templates: recordTemplates.optional(),
  entity_identity: entityIdentitySettings.optional(),
});
export type BusinessSettings = z.infer<typeof businessSettings>;
export function resolvedBusinessSettings(settings: BusinessSettings): BusinessSettings {
  return { record_templates: {}, entity_identity: defaultEntityIdentitySettings, ...businessSettings.parse(settings) };
}
const settingsVersion = z.number().int().nonnegative();
export const businessSettingsResult = z.object({
  versions: z.object({ record_templates: settingsVersion, entity_identity: settingsVersion }),
  settings: businessSettings,
});
export type BusinessSettingsResult = z.infer<typeof businessSettingsResult>;
export const businessSettingsRead = z.strictObject({
  id: z.enum(["entity_identity", "record_templates"]).optional(),
});
export type BusinessSettingsSectionResult<K extends keyof BusinessSettings> = {
  settings: Pick<BusinessSettings, K>;
  versions: Pick<BusinessSettingsResult["versions"], K>;
};
export type BusinessSettingsReadResult = {
  settings: BusinessSettings;
  versions: Partial<BusinessSettingsResult["versions"]>;
};
export const businessSettingsUpdate = z.discriminatedUnion("id", [
  z.strictObject({ id: z.literal("record_templates"), expected_version: settingsVersion, value: recordTemplates }),
  z.strictObject({
    id: z.literal("entity_identity"),
    expected_version: settingsVersion,
    value: entityIdentitySettings,
  }),
]);
export type BusinessSettingsUpdate = z.infer<typeof businessSettingsUpdate>;

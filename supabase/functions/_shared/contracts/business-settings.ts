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
  return { record_templates: {}, entity_identity: defaultEntityIdentitySettings, ...settings };
}
const settingsVersion = z.number().int().nonnegative();
export const businessSettingsResult = z.object({
  versions: z.object({ record_templates: settingsVersion, entity_identity: settingsVersion }),
  settings: businessSettings,
});
export type BusinessSettingsResult = z.infer<typeof businessSettingsResult>;
export const businessSettingsUpdate = z.discriminatedUnion("id", [
  z.strictObject({ id: z.literal("record_templates"), expected_version: settingsVersion, value: recordTemplates }),
  z.strictObject({
    id: z.literal("entity_identity"),
    expected_version: settingsVersion,
    value: entityIdentitySettings,
  }),
]);
export type BusinessSettingsUpdate = z.infer<typeof businessSettingsUpdate>;

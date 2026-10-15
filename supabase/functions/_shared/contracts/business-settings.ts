import { z } from "zod";
import { recordTemplates } from "./record-template.ts";

export const BUSINESS_SETTINGS_MAX_BYTES = 131072;
export const businessSettings = z.strictObject({
  record_templates: recordTemplates.optional(),
});
export type BusinessSettings = z.infer<typeof businessSettings>;
export function resolvedBusinessSettings(settings: BusinessSettings): BusinessSettings {
  const raw = settings.record_templates as
    | (Record<string, unknown> & Pick<NonNullable<BusinessSettings["record_templates"]>, "entity_types">)
    | undefined;
  let templates = raw;
  if (raw) {
    // Retire stored common settings without rewriting data on a read.
    const { entity: _retired, ...current } = raw;
    templates = {
      ...current,
      ...(raw.entity_types
        ? {
          entity_types: Object.fromEntries(
            Object.entries(raw.entity_types).map((
              [id, group],
            ) => [
              id,
              Object.fromEntries(
                Object.entries(group).map(([action, value]) => [action, {
                  ...value,
                  memo: value!.memo === null || value!.memo.trim() === "" ? null : value!.memo,
                }]),
              ),
            ]),
          ),
        }
        : {}),
    };
  }
  return {
    record_templates: {},
    ...businessSettings.parse({
      ...settings,
      ...(templates ? { record_templates: templates } : {}),
    }),
  };
}
const settingsVersion = z.number().int().nonnegative();
export const businessSettingsResult = z.object({
  versions: z.object({ record_templates: settingsVersion }),
  settings: businessSettings,
});
export type BusinessSettingsResult = z.infer<typeof businessSettingsResult>;
export const businessSettingsRead = z.strictObject({
  id: z.enum(["record_templates"]).optional(),
});
export type BusinessSettingsSectionResult<K extends keyof BusinessSettings> = {
  settings: Pick<BusinessSettings, K>;
  versions: Pick<BusinessSettingsResult["versions"], K>;
};
export type BusinessSettingsReadResult = {
  settings: BusinessSettings;
  versions: Partial<BusinessSettingsResult["versions"]>;
};
export const businessSettingsUpdate = z.strictObject({
  id: z.literal("record_templates"),
  expected_version: settingsVersion,
  value: recordTemplates,
});
export type BusinessSettingsUpdate = z.infer<typeof businessSettingsUpdate>;

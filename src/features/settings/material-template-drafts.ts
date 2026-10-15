import type { RecordTemplates } from "@contracts/record-template.ts";
import { createRecordTemplatesDraft } from "./business-settings-drafts.ts";
import { createSettingsDraft } from "./settings-draft.ts";
import { api } from "../../lib/api.ts";

/** A kind owns only its overrides; the checked baseline preserves other settings. */
export function createMaterialTemplateDraft(typeId: string) {
  const adapter = createRecordTemplatesDraft(api);
  return createSettingsDraft({
    ...adapter,
    toDraft: (saved: Awaited<ReturnType<typeof adapter.read>>): RecordTemplates => {
      const group = saved.settings.settings.record_templates?.entity_types?.[typeId];
      return group ? { entity_types: { [typeId]: structuredClone(group) } } : {};
    },
    save: (draft, before, signal, requestKey) => {
      const full = structuredClone(before.settings.settings.record_templates ?? {});
      const groups = { ...full.entity_types };
      const selected = draft.entity_types?.[typeId];
      if (selected) groups[typeId] = selected;
      else delete groups[typeId];
      return adapter.save({ ...full, entity_types: groups }, before, signal, requestKey);
    },
  });
}
export type MaterialTemplateResource = ReturnType<typeof createMaterialTemplateDraft>;

/** A model owns only its defaults; other targets remain in the checked baseline. */
export function createRecordModelDraft(model: "task") {
  const adapter = createRecordTemplatesDraft(api);
  return createSettingsDraft({
    ...adapter,
    toDraft: (saved: Awaited<ReturnType<typeof adapter.read>>): RecordTemplates => {
      const group = saved.settings.settings.record_templates?.[model];
      return group ? { [model]: structuredClone(group) } : {};
    },
    save: (draft, before, signal, requestKey) => {
      const full = structuredClone(before.settings.settings.record_templates ?? {});
      if (draft[model]) full[model] = draft[model];
      else delete full[model];
      return adapter.save(full, before, signal, requestKey);
    },
  });
}

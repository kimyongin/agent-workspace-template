import type { RecordTemplates } from "@contracts/record-template.ts";
import { createRecordTemplatesDraft } from "./business-settings-drafts.ts";
import { createSettingsDraft } from "./settings-draft.ts";
import type { ApiRequest } from "../../lib/api.ts";

/** A kind owns only its overrides; the checked baseline preserves other settings. */
export function createMaterialTemplateDraft(api: ApiRequest, typeId: string) {
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

/** Task defaults own only their settings; other targets remain in the checked baseline. */
export function createTaskTemplateDraft(api: ApiRequest) {
  const adapter = createRecordTemplatesDraft(api);
  return createSettingsDraft({
    ...adapter,
    toDraft: (saved: Awaited<ReturnType<typeof adapter.read>>): RecordTemplates => {
      const group = saved.settings.settings.record_templates?.task;
      return group ? { task: structuredClone(group) } : {};
    },
    save: (draft, before, signal, requestKey) => {
      const full = structuredClone(before.settings.settings.record_templates ?? {});
      if (draft.task) full.task = draft.task;
      else delete full.task;
      return adapter.save(full, before, signal, requestKey);
    },
  });
}

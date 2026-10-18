import type { BusinessSettingsSectionResult } from "@contracts/business-settings.ts";
import { type RecordTemplates, recordTemplates, recordTemplateTagIds } from "@contracts/record-template.ts";
import type { ApiRequest } from "../../lib/api.ts";
import { ApiError } from "../../lib/api-error.ts";
import { createTagRead } from "../tags/tag-read.ts";
import type { SettingsDraftAdapter } from "./settings-draft.ts";

const isConflict = (error: unknown) => error instanceof ApiError && error.status === 409;
type TemplatesSaved = { settings: BusinessSettingsSectionResult<"record_templates">; availableTags: string[] };
const selectedRecordTags = recordTemplateTagIds;
/** Only tags from the checked baseline can be reported missing; new local selections are not stale. */
export function unavailableTemplateTags(saved: TemplatesSaved | null, draft: RecordTemplates) {
  if (!saved) return [];
  const available = new Set(saved.availableTags);
  const missing = new Set(
    selectedRecordTags(saved.settings.settings.record_templates).filter((id) => !available.has(id)),
  );
  return [...new Set(selectedRecordTags(draft))].filter((id) => missing.has(id));
}
export function createRecordTemplatesDraft(api: ApiRequest): SettingsDraftAdapter<RecordTemplates, TemplatesSaved> {
  const tagRead = createTagRead(api);
  return {
    initial: {},
    isConflict,
    read: async (signal) => {
      const [settings, tags] = await Promise.all([
        api<BusinessSettingsSectionResult<"record_templates">>(
          "GET",
          "/settings/business?id=record_templates",
          undefined,
          signal,
        ),
        tagRead.all("record", signal),
      ]);
      return { settings, availableTags: tags.map((tag) => tag.id) };
    },
    save: async (value, before, signal, requestKey) => ({
      settings: await api(
        "PATCH",
        "/settings/business",
        {
          id: "record_templates",
          expected_version: before.settings.versions.record_templates,
          value: recordTemplates.parse(value),
        },
        signal,
        requestKey,
      ),
      availableTags: [...new Set([...before.availableTags, ...selectedRecordTags(value)])],
    }),
    toDraft: (saved) => structuredClone(saved.settings.settings.record_templates ?? {}),
  };
}

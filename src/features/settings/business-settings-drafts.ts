import {
  defaultEntityIdentitySettings,
  type EntityIdentitySettings,
  entityIdentitySettings,
  entitySourceGeneration,
} from "@contracts/entity-identity.ts";
import type { BusinessSettingsSectionResult } from "@contracts/business-settings.ts";
import {
  type RecordTemplates,
  recordTemplates,
  recordTemplateTagIds,
} from "@contracts/record-template.ts";
import type { api as request } from "../../lib/api.ts";
import { ApiError } from "../../lib/api-error.ts";
import { createTagRead } from "../tags/tag-read.ts";
import type { SettingsDraftAdapter } from "./settings-draft.ts";

const isConflict = (error: unknown) => error instanceof ApiError && error.status === 409;
function editable(value: EntityIdentitySettings) {
  const parsed = entityIdentitySettings.parse(value);
  return {
    ...parsed,
    sources: parsed.sources.map((source) => ({ ...source, generation: entitySourceGeneration(parsed, source.code) })),
  };
}
export function orderedSources(
  sources: EntityIdentitySettings["sources"],
  current: EntityIdentitySettings,
): EntityIdentitySettings {
  const first = sources.find((source) => !source.deleted)!;
  return { ...current, sources, default_source: first.code, generation: first.generation ?? current.generation };
}
export function createIdentitySettingsDraft(
  api: typeof request,
): SettingsDraftAdapter<EntityIdentitySettings, BusinessSettingsSectionResult<"entity_identity">> {
  return {
    initial: editable(defaultEntityIdentitySettings),
    isConflict,
    read: (signal) => api("GET", "/settings/business?id=entity_identity", undefined, signal),
    save: (value, before, signal, requestKey) =>
      api(
        "PATCH",
        "/settings/business",
        {
          id: "entity_identity",
          expected_version: before.versions.entity_identity,
          value: entityIdentitySettings.parse(value),
        },
        signal,
        requestKey,
      ),
    toDraft: (saved) => editable(saved.settings.entity_identity ?? defaultEntityIdentitySettings),
  };
}
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
export function createRecordTemplatesDraft(api: typeof request): SettingsDraftAdapter<RecordTemplates, TemplatesSaved> {
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

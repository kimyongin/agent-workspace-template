import type { BusinessSettings } from "../../contracts/business-settings.ts";
import { renderTemplate, type TemplateModel } from "../../contracts/record-template.ts";
import type { ChangeInput } from "../shared/changes.ts";
import { changeBody } from "../shared/change-memo.ts";

/** Both prepared requests and direct writes use this rule. Explicit empty tags mean clear. */
export function changeDefaults(input: ChangeInput, settings: BusinessSettings, availableTags: string[]) {
  const template = settings.record_templates?.[input.target_kind as TemplateModel]?.[input.action];
  const fallback = changeBody({ ...input, change_note: undefined });
  const rendered = template
    ? renderTemplate(template.memo, {
      target: input.target.title,
      action: input.action,
      model: input.target_kind as TemplateModel,
      changes: fallback,
      before: input.before as Record<string, unknown> | null,
      after: input.after as Record<string, unknown> | null,
    })
    : fallback;
  const change_note = input.change_note !== undefined ? changeBody(input) : rendered.trim() ? rendered : fallback;
  const defaults = template?.tag_ids ?? [];
  return {
    change_note,
    change_tag_ids: input.change_tag_ids ?? defaults.filter((id) => availableTags.includes(id)),
    missing_tag_ids: defaults.filter((id) => !availableTags.includes(id)),
  };
}

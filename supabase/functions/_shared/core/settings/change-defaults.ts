import type { BusinessSettings } from "../../contracts/business-settings.ts";
import {
  effectiveRecordTemplate,
  renderTemplate,
  templateIssues,
  type TemplateModel,
} from "../../contracts/record-template.ts";
import type { ChangeInput } from "../shared/changes.ts";
import { changeBody, changedFieldNames } from "../shared/change-memo.ts";
import { codePointLength, TEXT_LIMITS } from "../../contracts/common.ts";
import { invalidInput } from "../shared/errors.ts";

/** Both prepared requests and direct writes use this rule. Explicit empty tags mean clear. */
export function changeDefaults(input: ChangeInput, settings: BusinessSettings, availableTags: string[]) {
  const template = effectiveRecordTemplate(
    settings.record_templates,
    input.target_kind as TemplateModel,
    input.action,
    (input.after ?? input.before)?.entity_type_id,
  );
  // Records use the existing action memo; user-editable template models exclude records.
  const issues = input.target_kind === "record" ? [] : templateIssues(template.memo, input.target_kind, input.action);
  if (issues.length) {
    throw invalidInput("기록 템플릿의 변수를 확인하세요", [{
      path: `record_templates.${input.target_kind}.${input.action}.memo`,
      message: issues.map((issue) => issue.reason).join(" · "),
    }]);
  }
  const fallback = changeBody({ ...input, change_note: undefined });
  const rendered = renderTemplate(template.memo, {
    target: input.target.title,
    action: input.action,
    model: input.target_kind as TemplateModel,
    changes: fallback,
    changed_fields: changedFieldNames(input),
    before: input.before as Record<string, unknown> | null,
    after: input.after as Record<string, unknown> | null,
  });
  const change_note = input.change_note !== undefined ? changeBody(input) : rendered.trim() ? rendered : fallback;
  if (codePointLength(change_note) > TEXT_LIMITS.body.max) {
    throw invalidInput("생성한 기록 메모가 너무 깁니다", [{
      path: "change_note",
      message: `생성한 기록 메모는 ${TEXT_LIMITS.body.max}자 이하로 줄이세요`,
    }]);
  }
  const defaults = template?.tag_ids ?? [];
  return {
    change_note,
    change_tag_ids: input.change_tag_ids ?? defaults.filter((id) => availableTags.includes(id)),
    missing_tag_ids: defaults.filter((id) => !availableTags.includes(id)),
  };
}

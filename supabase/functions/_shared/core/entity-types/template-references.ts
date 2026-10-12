import {
  effectiveEntityTemplates,
  effectiveRecordTemplate,
  modelActions,
  type RecordTemplates,
  templateIssues,
} from "../../contracts/record-template.ts";
import type { SchemaDefinition } from "../../contracts/entity-schema-change.ts";
import { sha256Hex } from "../shared/operations.ts";
import { invalidInput } from "../shared/errors.ts";
/** Only the chosen type’s effective memo and tags can stale its schema change. */
export async function effectiveEntityTemplateFingerprint(templates: RecordTemplates | undefined, typeId: string) {
  return await sha256Hex(JSON.stringify(effectiveEntityTemplates(templates, typeId)));
}
export function assertSchemaTemplateReferences(target: SchemaDefinition, templates: RecordTemplates, typeId?: string) {
  for (const action of modelActions("entity")) {
    const { memo } = effectiveRecordTemplate(templates, "entity", action, typeId);
    const issues = templateIssues(memo, "entity", action).map((i) => i.reason);
    for (const match of memo.matchAll(/\$\{([^$]*?)\$\}|\$\$|\$([^$]*?)\$/g)) {
      if (match[0] === "$$") continue;
      const variable = match[1] ?? match[2];
      const ref = /^엔터티\.(?:이전|이후)\.(prop_[1-9][0-9]*)$/.exec(variable);
      if (ref && (!target.schema.properties[ref[1]] || target.display.archived.includes(ref[1]))) {
        issues.push(`${ref[1]} 참조가 없거나 보관되어 있습니다. 기록 템플릿을 먼저 수정하세요`);
      }
    }
    if (issues.length) {
      throw invalidInput("기록 템플릿의 속성 참조를 확인하세요", [{
        path: typeId
          ? `record_templates.entity_types.${typeId}.${action}.memo`
          : `record_templates.entity.${action}.memo`,
        message: issues.join(" · "),
      }]);
    }
  }
}

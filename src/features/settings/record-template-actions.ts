import {
  modelActions,
  type RecordTemplates,
  type TemplateAction,
  type TemplateModel,
} from "@contracts/record-template.ts";

export function templateFieldTarget(
  path: string,
): { model: TemplateModel; action: TemplateAction; typeId?: string } | null {
  const parts = path.replace(/^(?:value|record_templates)\./, "").split(".");
  const model = parts[0] === "entity_types" ? "entity" : parts[0];
  if (model !== "entity" && model !== "task") return null;
  const action = parts[0] === "entity_types" ? parts[2] : parts[1];
  if (!modelActions(model).includes(action as TemplateAction)) return null;
  return { model, action: action as TemplateAction, ...(parts[0] === "entity_types" ? { typeId: parts[1] } : {}) };
}

export function changedTemplateActions(
  draft: RecordTemplates,
  saved: RecordTemplates,
  model: TemplateModel,
  typeId: string,
) {
  const current = model === "entity" ? draft.entity_types?.[typeId] : draft[model];
  const baseline = model === "entity" ? saved.entity_types?.[typeId] : saved[model];
  return modelActions(model).filter((action) =>
    JSON.stringify(current?.[action]) !== JSON.stringify(baseline?.[action])
  );
}

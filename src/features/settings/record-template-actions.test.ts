import { expect, test } from "vitest";
import { changedTemplateActions, templateFieldTarget } from "./record-template-actions.ts";
const typeId = "11111111-1111-4111-8111-111111111111";

test("template errors identify their real action after a type UUID and request prefixes", () => {
  expect(templateFieldTarget(`entity_types.${typeId}.create.memo`)).toEqual({
    model: "entity",
    typeId,
    action: "create",
  });
  expect(templateFieldTarget(`value.entity_types.${typeId}.delete.tag_ids.0`)).toEqual({
    model: "entity",
    typeId,
    action: "delete",
  });
  expect(templateFieldTarget("record_templates.task.resume.memo")).toEqual({ model: "task", action: "resume" });
  for (const path of ["entity_types.bad.create_extra.memo", "task.restore.memo", "unknown.create", "entity_types.id"]) {
    expect(templateFieldTarget(path)).toBeNull();
  }
});
test("change summaries use the exact scoped overrides, including restoring a constant default", () => {
  const saved = {
    entity_types: { [typeId]: { create: { memo: "원래 문구", tag_ids: [] } } },
    task: { create: { memo: "유지", tag_ids: [] } },
  };
  const draft = {
    entity_types: { [typeId]: { create: { memo: null, tag_ids: [] }, delete: { memo: "삭제 문구", tag_ids: [] } } },
    task: saved.task,
  };
  expect(changedTemplateActions(draft, saved, "entity", typeId)).toEqual(["create", "delete"]);
  expect(changedTemplateActions(draft, saved, "task", "")).toEqual([]);
  expect(changedTemplateActions(saved, saved, "entity", typeId)).toEqual([]);
});

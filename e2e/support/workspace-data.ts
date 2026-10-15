import {
  APP_IDENTIFIER_RULE_ID,
  type EntityTypeIdentity,
} from "../../supabase/functions/_shared/contracts/entity-issuer.ts";
import { initialEntityDefinition } from "../../supabase/functions/_shared/contracts/entity-type.ts";
import type { EntityDetail } from "../../supabase/functions/_shared/contracts/entity.ts";
import type { TaskDetail, TaskListItem } from "../../supabase/functions/_shared/contracts/task.ts";
import type { RecordResult } from "../../supabase/functions/_shared/contracts/record.ts";
import type { PrincipleResult } from "../../supabase/functions/_shared/contracts/principle.ts";
import type { TagResult } from "../../supabase/functions/_shared/contracts/tag.ts";
export const stamp = "2026-10-04T03:00:00Z";
export const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const base = (n: number, title: string) => ({
  id: id(n),
  title,
  body: "상세 본문",
  version: 1,
  created_at: stamp,
  updated_at: stamp,
});
export const identity = (n: number) => ({ id: id(n), version: 1, created_at: stamp, updated_at: stamp });
export const entityKey = (n: number) => `app:${id(900)}:${id(n)}`;
export const fixtureType = {
  id: id(900),
  label: "검사 자료",
  icon_id: "box",
  archived: false,
  schema_version: 1,
  next_property_number: 5,
  created_at: stamp,
  updated_at: stamp,
};
export function fixtureIdentity(typeId = fixtureType.id): EntityTypeIdentity {
  return {
    type_id: typeId,
    label: "번호",
    default_source: "app",
    version: 1,
    sources: [{
      code: "app",
      rule_id: APP_IDENTIFIER_RULE_ID,
      active: true,
      referenced: false,
      source_label: "앱",
      rule_label: "자동 발급",
      generation: "automatic",
    }],
  };
}
export const fixtureSchema = (() => {
  const definition = initialEntityDefinition("제목", {
    id: fixtureType.id,
    title: fixtureType.label,
    icon: fixtureType.icon_id,
  });
  Object.assign(definition.schema.properties, {
    prop_2: { "x-order": 20, type: ["integer", "null"], title: "수량", default: 0 },
    prop_3: { "x-order": 30, type: ["string", "null"], title: "날짜", format: "date", default: null },
    prop_4: {
      "x-order": 40,
      type: "string",
      title: "분류",
      oneOf: [{ const: "a" }, { const: "b" }, { const: "c" }],
      default: "a",
    },
  });

  definition.schema.properties["prop_2"]["x-show-in-list"] = true;
  return { ...definition, type_id: fixtureType.id, type: fixtureType, schema_version: 1 };
})();
export const entity = (n = 1, properties: Partial<EntityDetail["properties"]> = {}): EntityDetail => ({
  ...identity(n),
  id: entityKey(n),
  source: "app",
  external_id: id(n),
  source_label: "앱",
  deleted_at: null,
  entity_type_id: fixtureType.id,
  type: fixtureType,
  schema_version: 1,
  current_schema_version: 1,
  title: String(properties.prop_1 ?? "자료"),
  properties: { prop_1: "자료", prop_2: 0, prop_3: null, prop_4: "a", ...properties },
  display_properties: { prop_1: properties.prop_1 ?? "자료", prop_2: properties.prop_2 ?? 0 },
  tag_ids: [],
  tasks: { count: 0, items: [] },
  records: { count: 0, items: [] },
});
export const task = (n = 2): TaskDetail & TaskListItem => ({
  ...identity(n),
  title: "할 일",
  body: "상세 본문",
  kind: "once",
  status: "open",
  due_on: null,
  recurrence: null,
  timezone: null,
  result_record: null,
  completed_at: null,
  result_record_id: null,
  pauses: [],
  tag_ids: [],
  entity_ids: [],
  entity_context: [],
  occurrence: null,
});
export const record = (n = 3): RecordResult => ({
  ...identity(n),
  body: "기록",
  record_kind: "user",
  change: null,
  occurred_at: stamp,
  task_id: null,
  occurrence_on: null,
  tag_ids: [],
  entity_ids: [],
  entity_context: [],
  applied_principle_snapshots: [],
});
export const principle = (n = 4, current = true): PrincipleResult => ({
  ...identity(n),
  title: current ? "현재 기준" : "과거 기준",
  body: "상세 본문",
  is_current: current,
  saved_at: stamp,
  origin: "saved",
  legacy_context: null,
});
export type WorkspaceRows = {
  entities: EntityDetail[];
  tasks: (TaskDetail & TaskListItem)[];
  records: RecordResult[];
  principles: PrincipleResult[];
  tags: TagResult[];
};

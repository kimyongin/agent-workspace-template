import { renderEntityTitle } from "../../supabase/functions/_shared/contracts/entity-title-template.ts";
import {
  APP_IDENTIFIER_RULE_ID,
  type IdentifierKindMetadata,
} from "../../supabase/functions/_shared/contracts/entity-issuer.ts";
import { initialEntityDefinition } from "../../supabase/functions/_shared/contracts/entity-type.ts";
import { encodeIdentifierReference, encodeIdentifierValue } from "../../supabase/functions/_shared/contracts/entity-identifiers.ts";
import type { EntityDetail } from "../../supabase/functions/_shared/contracts/entity.ts";
import type {
  TaskDetail,
  TaskListItem,
} from "../../supabase/functions/_shared/contracts/task.ts";
import type { RecordResult } from "../../supabase/functions/_shared/contracts/record.ts";
import type { TagResult } from "../../supabase/functions/_shared/contracts/tag.ts";
export const stamp = "2026-10-04T03:00:00Z";
export const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const base = (n: number, title: string) => ({
  id: id(n),
  title,
  body: "상세 본문",
  version: 1,
  created_at: stamp,
  updated_at: stamp,
});
export const identity = (n: number) => ({
  id: id(n),
  version: 1,
  created_at: stamp,
  updated_at: stamp,
});
export const entityKey = (n: number) => encodeIdentifierReference(id(900), APP_IDENTIFIER_RULE_ID, id(n));
export const fixtureType = {
  id: id(900),
  label: "검사 자료",
  icon_id: "box",
  archived: false,
  schema_version: 1,
  next_property_number: 6,
  created_at: stamp,
  updated_at: stamp,
};
export const fixtureSchema = (() => {
  const definition = initialEntityDefinition("제목", {
    id: fixtureType.id,
    title: fixtureType.label,
    icon: fixtureType.icon_id,
  });
  definition.schema.properties.prop_5 = { ...definition.schema.properties.prop_2, "x-order": 50 };
  definition.schema["x-identity-property"] = "prop_5";
  definition.schema.required = ["prop_1", "prop_5"];
  Object.assign(definition.schema.properties, {
    prop_2: {
      "x-order": 20,
      type: ["integer", "null"],
      title: "수량",
      default: 0,
    },
    prop_3: {
      "x-order": 30,
      type: ["string", "null"],
      title: "날짜",
      format: "date",
      default: null,
    },
    prop_4: {
      "x-order": 40,
      type: "string",
      title: "분류",
      oneOf: [{ const: "a" }, { const: "b" }, { const: "c" }],
      default: "a",
    },
  });


  return {
    ...definition,
    type_id: fixtureType.id,
    type: fixtureType,
    schema_version: 1,
    identifier_kinds: [{ id: APP_IDENTIFIER_RULE_ID, source: "app", source_label: "앱", label: "자동 발급", active: true, generation: "automatic", version: 1, source_version: 1 }] as IdentifierKindMetadata[],
  };
})();
export const entity = (
  n = 1,
  properties: Partial<EntityDetail["properties"]> = {},
): EntityDetail => ({
  ...identity(n),
  id: entityKey(n),
  identity_label: `앱 · 자동 발급 · ${id(n)}`,
  deleted_at: null,
  entity_type_id: fixtureType.id,
  type: fixtureType,
  schema_version: 1,
  current_schema_version: 1,
  title: renderEntityTitle(fixtureSchema.schema, { prop_1: "자료", ...properties }, id(n)),
  properties: {
    prop_1: "자료",
    prop_2: 0,
    prop_3: null,
    prop_4: "a",
    prop_5: encodeIdentifierValue(APP_IDENTIFIER_RULE_ID, id(n)),
    ...properties,
  },

  tag_ids: [],
  tasks: { count: 0, items: [] },
  records: { count: 0, items: [] },
});
export const task = (n = 2): TaskDetail & TaskListItem => ({
  ...identity(n),
  deleted_at: null,
  created_by: null,
  created_by_name: null,
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
  record_kind: "result",
  created_by: null,
  created_by_name: null,
  change: null,
  occurred_at: stamp,
  entity_id: null,
  task_id: id(2),
  occurrence_on: null,
  tag_ids: [],
});

export type WorkspaceRows = {
  entities: EntityDetail[];
  tasks: (TaskDetail & TaskListItem)[];
  records: RecordResult[];

  tags: TagResult[];
};

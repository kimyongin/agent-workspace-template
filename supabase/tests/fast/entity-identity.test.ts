import { requestActor } from "../_request.ts";
import type { ChangeInput } from "../../functions/_shared/core/shared/changes.ts";
import { assertEquals, assertRejects } from "@std/assert";
import { type EntityCreate, entityCreate, type EntityValues } from "../../functions/_shared/contracts/entity.ts";
import { initialEntityDefinition } from "../../functions/_shared/contracts/entity-type.ts";
import type { EntityDefinition } from "../../functions/_shared/core/entity/values.ts";
import {
  createEntity,
  deleteEntity,
  type EntityDeps,
  type EntityStore,
  getEntity,
  updateEntity,
} from "../../functions/_shared/core/entity/application.ts";
import { type BusinessSettingsDeps, prepareBusinessRecord } from "../../functions/_shared/core/settings/application.ts";
import { entityChangeFacts } from "../../functions/_shared/core/entity/change.ts";
import { AppError } from "../../functions/_shared/core/shared/errors.ts";
const typeId = "00000000-0000-4000-8000-000000000001";
const definition: EntityDefinition = {
  ...initialEntityDefinition("속성 1"),
  type_id: typeId,
  schema_version: 1,
  type_version: 1,
  type: { id: typeId, label: "검사 자료", icon_id: "box", archived: false },
};
definition.schema.properties.prop_1.maxLength = 100;
definition.schema.properties.prop_2 = { type: ["integer", "null"], minimum: 0, maximum: 1_000_000, default: null };
definition.schema.properties.prop_3 = { type: ["string", "null"], format: "date", default: null };
definition.schema.properties.prop_4 = { type: "string", enum: ["a", "b", "c"], default: "a" };
definition.display.order = ["prop_1", "prop_2", "prop_3", "prop_4"];
const schema = { entity_type_id: typeId, schema_version: 1 };

Deno.test("Entity registration uses exact namespaced identity and rejects active duplicate", async () => {
  const rows = new Map();
  const store = {
    definition: () => Promise.resolve(definition),
    executeRequest: <T>(_request: unknown, execute: () => Promise<T>) => execute(),
    get: (id: string) => Promise.resolve(rows.get(id) ?? null),
    getBusinessSettings: () =>
      Promise.resolve({
        version: 1,
        settings: {
          entity_identity: {
            generation: "manual",
            default_source: "crm",
            sources: [{ code: "app", label: "앱" }, { code: "crm", label: "CRM" }],
          },
        },
      }),
    insert: (i: Parameters<EntityStore["insert"]>[0]) => {
      const row = {
        ...i,
        type: definition.type,
        title: String(i.properties.prop_1),
        current_schema_version: 1,
        display_properties: i.properties,
        version: 1,
        deleted_at: null,
      };
      rows.set(i.id, row);
      return Promise.resolve(row);
    },
    appendChange: () => Promise.resolve(),
  } as unknown as EntityStore;
  const d: EntityDeps = { uow: { run: (_a, fn) => fn(store) } }, actor = { userId: crypto.randomUUID() };
  const input = entityCreate.parse({
    ...schema,
    source: "crm",
    external_id: "000Ab:/한글%",
    properties: { prop_1: "고객" },
  });
  const created = await createEntity(d, requestActor(actor), input);
  assertEquals(created.id, "crm:000Ab:/한글%");
  assertEquals(created.external_id, "000Ab:/한글%");
  assertEquals((await assertRejects(() => createEntity(d, requestActor(actor), input), AppError)).code, "conflict");
});

Deno.test("Deleted entity registration preserves omitted values and rejects stale writes after restore", async () => {
  let row: EntityValues | null = null;
  const events: string[] = [];
  const store = {
    definition: () => Promise.resolve(definition),
    executeRequest: <T>(_request: unknown, execute: () => Promise<T>) => execute(),
    get: () => Promise.resolve(row),
    related: () => Promise.resolve({ tasks: { count: 1, items: [] }, records: { count: 1, items: [] } }),
    getBusinessSettings: () => Promise.resolve({ settings: {} }),
    insert: (i: Parameters<EntityStore["insert"]>[0]) => {
      row = {
        ...i,
        type: definition.type,
        title: String(i.properties.prop_1),
        current_schema_version: 1,
        display_properties: i.properties,
        source_label: i.source,
        created_at: "2026-10-09T00:00:00Z",
        updated_at: "2026-10-09T00:00:00Z",
        tag_ids: i.tag_ids ?? [],
        deleted_at: null,
        version: 1,
      };
      return Promise.resolve(row);
    },
    delete: () => {
      row = { ...row!, deleted_at: "2026-10-09T00:00:00Z", version: row!.version + 1 };
      return Promise.resolve();
    },
    restore: (_id: string, changes: EntityCreate) => {
      row = { ...row!, ...changes, deleted_at: null, version: row!.version + 1 };
      return Promise.resolve(row);
    },
    appendChange: (input: ChangeInput) => {
      events.push(input.action);
      return Promise.resolve();
    },
  } as unknown as EntityStore;
  const d: EntityDeps = { uow: { run: (_a, fn) => fn(store) } }, actor = { userId: crypto.randomUUID() };
  const created = await createEntity(
    d,
    requestActor(actor),
    entityCreate.parse({
      ...schema,
      source: "app",
      external_id: "001",
      properties: { prop_1: "보관 대상", prop_2: 0, prop_4: "c" },
    }),
  );
  await deleteEntity(d, requestActor(actor), created.id, 1);
  assertEquals((await getEntity(d, actor, created.id)).deleted_at, "2026-10-09T00:00:00Z");
  await assertRejects(
    () =>
      createEntity(
        d,
        requestActor(actor),
        entityCreate.parse({ ...schema, source: "app", external_id: "001", properties: {} }),
      ),
    AppError,
  );
  const settingsDeps: BusinessSettingsDeps = {
    clock: { now: () => new Date("2026-10-10T00:00:00Z") },
    uow: {
      run: (_actor, fn) =>
        fn({
          definition: () => Promise.resolve(definition),
          executeRequest: <T>(_request: unknown, execute: () => Promise<T>) => execute(),
          get: () =>
            Promise.resolve({
              versions: { record_templates: 1, entity_identity: 0 },
              settings: {
                record_templates: {
                  entity: {
                    restore: {
                      memo: "$엔터티.이후.prop_1$ / $엔터티.이후.prop_2$ / $엔터티.이후.prop_4$",
                      tag_ids: [],
                    },
                  },
                },
              },
            }),
          target: () =>
            Promise.resolve(
              row ? { version: row.version, deleted_at: row.deleted_at, facts: entityChangeFacts(row) } : null,
            ),
          recordTags: () => Promise.resolve([]),
          update: () => Promise.reject(new Error("읽기 전용")),
        }),
    },
  };
  const prepared = await prepareBusinessRecord(settingsDeps, actor, {
    model: "entity",
    action: "restore",
    target_id: created.id,
    expected_version: 2,
    input: { ...schema, properties: { prop_3: "2026-10-09" } },
  });
  assertEquals(prepared.change_note, "보관 대상 / 0 / c");
  const restored = await createEntity(
    d,
    requestActor(actor),
    entityCreate.parse({
      ...prepared.prepared_input,
      change_note: prepared.change_note,
      change_tag_ids: prepared.change_tag_ids,
    }),
  );
  assertEquals([
    restored.properties.prop_1,
    restored.properties.prop_2,
    restored.properties.prop_4,
    restored.version,
    restored.deleted_at,
  ], [
    "보관 대상",
    0,
    "c",
    3,
    null,
  ]);
  assertEquals(events, ["create", "delete", "restore"]);
  await assertRejects(
    () => createEntity(d, requestActor(actor), entityCreate.parse(prepared.prepared_input)),
    AppError,
  );

  await assertRejects(
    () =>
      updateEntity(d, requestActor(actor), created.id, {
        schema_version: 1,
        expected_version: 1,
        properties: { prop_1: "오래된 요청" },
      }),
    AppError,
  );
});

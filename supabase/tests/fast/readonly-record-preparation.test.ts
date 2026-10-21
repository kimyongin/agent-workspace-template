import { assertEquals, assertRejects } from "@std/assert";
import {
  entityCreate,
  entityRestore,
  entityUpdate,
  type EntityValues,
} from "../../functions/_shared/contracts/entity.ts";
import { initialEntityDefinition } from "../../functions/_shared/contracts/entity-type.ts";
import {
  createEntity,
  deleteEntity,
  type EntityDeps,
  type EntityStore,
  restoreEntity,
  updateEntity,
} from "../../functions/_shared/core/entity/application.ts";
import { entityChangeFacts } from "../../functions/_shared/core/entity/change.ts";
import { type BusinessSettingsDeps, prepareBusinessRecord } from "../../functions/_shared/core/settings/application.ts";
import type { ChangeInput } from "../../functions/_shared/core/shared/changes.ts";
import { AppError } from "../../functions/_shared/core/shared/errors.ts";
import { identifierKindsFixture } from "../_entity-identity.ts";
import { requestActor } from "../_request.ts";

function fixture(
  readonlyRepresentative = false,
  memo = "$엔터티.이후.prop_1$/$엔터티.이후.prop_3$/$엔터티.이후.prop_4$",
) {
  const typeId = crypto.randomUUID(), actor = { userId: crypto.randomUUID() };
  const definition = initialEntityDefinition("이름", { id: typeId, title: "자료", icon: "box" });
  if (readonlyRepresentative) Object.assign(definition.schema.properties.prop_1, { readOnly: true, default: "Auto" });
  definition.schema.properties.prop_3 = { type: "string", "x-order": 30, readOnly: true, default: "LOCKED" };
  definition.schema.properties.prop_4 = { type: "string", "x-order": 40, default: "editable" };
  const storedDefinition = {
    ...definition,
    type_id: typeId,
    schema_version: 1,
    type_version: 1,
    identifier_kinds: identifierKindsFixture(),
    type: { id: typeId, label: "자료", icon_id: "box", archived: false },
  };
  let row: EntityValues | null = null;
  const events: ChangeInput[] = [];
  const store = {
    executeRequest: <T>(_request: unknown, run: () => Promise<T>) => run(),
    definition: () => Promise.resolve(storedDefinition),
    issueDataId: () => Promise.resolve("001"),
    get: (id: string) => Promise.resolve(row?.id === id ? row : null),
    insert: (input: Parameters<EntityStore["insert"]>[0]) => {
      row = {
        ...input,
        type: storedDefinition.type,
        title: String(input.properties.prop_1),

        current_schema_version: 1,
        identity_label: "앱 · 자동 발급 · 001",
        tag_ids: [],
        version: 1,
        deleted_at: null,
        created_at: "2026-10-16T00:00:00Z",
        updated_at: "2026-10-16T00:00:00Z",
      };
      return Promise.resolve(row);
    },
    update: (_id: string, input: Parameters<EntityStore["update"]>[1]) =>
      Promise.resolve(row = { ...row!, ...input, version: row!.version + 1 }),
    delete: () => {
      row = { ...row!, deleted_at: "2026-10-16T00:00:00Z", version: row!.version + 1 };
      return Promise.resolve();
    },
    restore: (_id: string, input: Parameters<EntityStore["restore"]>[1]) =>
      Promise.resolve(row = { ...row!, ...input, deleted_at: null, version: row!.version + 1 }),
    appendChange: (input: ChangeInput) => {
      events.push(input);
      return Promise.resolve();
    },
  } as unknown as EntityStore;
  const deps: EntityDeps = { uow: { run: (_actor, run) => run(store) } };
  const settings: BusinessSettingsDeps = {
    clock: { now: () => new Date("2026-10-16T00:00:00Z") },
    uow: {
      run: (_actor, run) =>
        run({
          executeRequest: store.executeRequest,
          definition: store.definition,
          getForTarget() {
            return this.get();
          },
          get: () =>
            Promise.resolve({
              versions: { record_templates: 1 },
              settings: {
                record_templates: {
                  entity_types: {
                    [typeId]: Object.fromEntries(
                      ["create", "update", "restore"].map((action) => [action, {
                        memo,
                        tag_ids: [],
                      }]),
                    ),
                  },
                },
              },
            }),
          target: (_model, id) =>
            Promise.resolve(
              row?.id === id
                ? {
                  version: row.version,
                  deleted_at: row.deleted_at,
                  facts: entityChangeFacts(row),
                }
                : null,
            ),
          recordTags: () => Promise.resolve([]),
          update: () => Promise.reject(new Error("preparation cannot write settings")),
        }),
    },
  };
  return { typeId, actor, deps, settings, events, definition };
}

Deno.test("record preparation renders the same composed entity title from effective defaulted properties", async () => {
  const f = fixture(false, "$엔터티.이후.제목$");
  f.definition.schema["x-title-template"] = "$prop_1$ - $prop_4$";
  const prepared = await prepareBusinessRecord(f.settings, f.actor, {
    model: "entity",
    action: "create",
    input: { entity_type_id: f.typeId, schema_version: 1, properties: { prop_1: "초록상점" } },
  });
  assertEquals(prepared.change_note, "초록상점 - editable");
  assertEquals(prepared.prepared_input.properties, { prop_1: "초록상점", prop_4: "editable" });
});

Deno.test("record preparation → create keeps readonly defaults in memo/server values and returns writable input", async () => {
  const f = fixture();
  const prepared = await prepareBusinessRecord(f.settings, f.actor, {
    model: "entity",
    action: "create",
    input: { entity_type_id: f.typeId, schema_version: 1, properties: { prop_1: "상품" } },
  });
  assertEquals(prepared.change_note, "상품/LOCKED/editable");
  const created = await createEntity(
    f.deps,
    requestActor(f.actor),
    entityCreate.parse({
      ...prepared.prepared_input,
      change_note: prepared.change_note,
      change_tag_ids: prepared.change_tag_ids,
    }),
  );
  assertEquals(prepared.prepared_input.properties, { prop_1: "상품", prop_4: "editable" });
  assertEquals(created.properties, {
    prop_2: "00000000-0000-4000-8000-000000000001:001",
    prop_1: "상품",
    prop_3: "LOCKED",
    prop_4: "editable",
  });
  assertEquals(f.events[0].change_note, "상품/LOCKED/editable");
});

Deno.test("record preparation → create supports a readonly representative default without accepting caller readonly input", async () => {
  const f = fixture(true);
  const prepared = await prepareBusinessRecord(f.settings, f.actor, {
    model: "entity",
    action: "create",
    input: { entity_type_id: f.typeId, schema_version: 1, properties: {} },
  });
  assertEquals(prepared.change_note, "Auto/LOCKED/editable");
  assertEquals(prepared.prepared_input.properties, { prop_4: "editable" });
  const created = await createEntity(f.deps, requestActor(f.actor), entityCreate.parse(prepared.prepared_input));
  assertEquals(created.properties, {
    prop_2: "00000000-0000-4000-8000-000000000001:001",
    prop_1: "Auto",
    prop_3: "LOCKED",
    prop_4: "editable",
  });
  const error = await assertRejects(() =>
    prepareBusinessRecord(f.settings, f.actor, {
      model: "entity",
      action: "create",
      input: { entity_type_id: f.typeId, schema_version: 1, properties: { prop_3: "LOCKED" } },
    }), AppError);
  assertEquals(error.code, "invalid_input");
  assertEquals(error.fields?.[0].path, "properties.prop_3");
});

for (const action of ["update", "restore"] as const) {
  Deno.test(`record preparation → ${action} preserves omitted and same-existing readonly values without applying new defaults`, async () => {
    const f = fixture(true);
    const prepared = await prepareBusinessRecord(f.settings, f.actor, {
      model: "entity",
      action: "create",
      input: { entity_type_id: f.typeId, schema_version: 1, properties: {} },
    });
    let entity = await createEntity(f.deps, requestActor(f.actor), entityCreate.parse(prepared.prepared_input));
    f.definition.schema.properties.prop_3.default = "NEW DEFAULT";
    for (const explicitReadonly of [false, true]) {
      if (action === "restore") {
        await deleteEntity(f.deps, requestActor(f.actor), entity.id, entity.version);
        entity = { ...entity, version: entity.version + 1 };
      }
      const patch = {
        prop_4: explicitReadonly ? "second" : "first",
        ...(explicitReadonly ? { prop_1: "Auto", prop_3: "LOCKED" } : {}),
      };
      const result = await prepareBusinessRecord(f.settings, f.actor, {
        model: "entity",
        action,
        target_id: entity.id,
        expected_version: entity.version,
        input: { schema_version: 1, properties: patch },
      });
      assertEquals(result.change_note, `Auto/LOCKED/${explicitReadonly ? "second" : "first"}`);
      assertEquals(result.prepared_input.properties, patch);
      const input = {
        ...result.prepared_input,
        change_note: result.change_note,
        change_tag_ids: result.change_tag_ids,
      };
      entity = action === "restore"
        ? await restoreEntity(f.deps, requestActor(f.actor), entity.id, entityRestore.parse(input))
        : await updateEntity(f.deps, requestActor(f.actor), entity.id, entityUpdate.parse(input));
      assertEquals(entity.properties, {
        prop_2: "00000000-0000-4000-8000-000000000001:001",
        prop_1: "Auto",
        prop_3: "LOCKED",
        prop_4: patch.prop_4,
      });
      assertEquals(f.events.at(-1)?.change_note, result.change_note);
    }
    const error = await assertRejects(() =>
      prepareBusinessRecord(f.settings, f.actor, {
        model: "entity",
        action: "update",
        target_id: entity.id,
        expected_version: entity.version,
        input: { schema_version: 1, properties: { prop_3: "changed" } },
      }), AppError);
    assertEquals(error.code, "invalid_input");
    assertEquals(error.fields?.[0].path, "properties.prop_3");
  });
}

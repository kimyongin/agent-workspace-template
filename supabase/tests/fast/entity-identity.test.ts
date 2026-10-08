import type { ChangeInput } from "../../functions/_shared/core/shared/changes.ts";
import { assertEquals, assertRejects } from "@std/assert";
import { type EntityCreate, entityCreate, type EntityResult } from "../../functions/_shared/contracts/entity.ts";
import {
  createEntity,
  deleteEntity,
  type EntityDeps,
  type EntityStore,
  getEntity,
  updateEntity,
} from "../../functions/_shared/core/entity/application.ts";
import { AppError } from "../../functions/_shared/core/shared/errors.ts";

Deno.test("Entity registration uses exact namespaced identity and rejects active duplicate", async () => {
  const rows = new Map();
  const store = {
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
    insert: (i: Record<string, unknown>) => {
      const row = { ...i, version: 1, deleted_at: null };
      rows.set(i.id, row);
      return Promise.resolve(row);
    },
    appendChange: () => Promise.resolve(),
  } as unknown as EntityStore;
  const d: EntityDeps = { uow: { run: (_a, fn) => fn(store) } }, actor = { userId: crypto.randomUUID() };
  const input = entityCreate.parse({ source: "crm", external_id: "000Ab:/한글%", prop1: "고객" });
  const created = await createEntity(d, actor, input);
  assertEquals(created.id, "crm:000Ab:/한글%");
  assertEquals(created.external_id, "000Ab:/한글%");
  assertEquals((await assertRejects(() => createEntity(d, actor, input), AppError)).code, "conflict");
});

Deno.test("Deleted entity registration preserves omitted values and rejects stale writes after restore", async () => {
  let row: EntityResult | null = null;
  const events: string[] = [];
  const store = {
    get: () => Promise.resolve(row),
    related: () => Promise.resolve({ tasks: { count: 1, items: [] }, records: { count: 1, items: [] } }),
    getBusinessSettings: () => Promise.resolve({ settings: {} }),
    insert: (i: Parameters<EntityStore["insert"]>[0]) => {
      row = {
        ...i,
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
    actor,
    entityCreate.parse({ source: "app", external_id: "001", prop1: "보관 대상", prop2: 0, prop4: "c" }),
  );
  await deleteEntity(d, actor, created.id, 1);
  assertEquals((await getEntity(d, actor, created.id)).deleted_at, "2026-10-09T00:00:00Z");
  await assertRejects(
    () => createEntity(d, actor, entityCreate.parse({ source: "app", external_id: "001" })),
    AppError,
  );
  const restored = await createEntity(
    d,
    actor,
    entityCreate.parse({ source: "app", external_id: "001", expected_version: 2, prop3: "2026-10-09" }),
  );
  assertEquals([restored.prop1, restored.prop2, restored.prop4, restored.version, restored.deleted_at], [
    "보관 대상",
    0,
    "c",
    3,
    null,
  ]);
  assertEquals(events, ["create", "delete", "restore"]);
  await assertRejects(
    () => updateEntity(d, actor, created.id, { expected_version: 1, prop1: "오래된 요청" }),
    AppError,
  );
});

import { assertEquals, assertRejects } from "@std/assert";
import {
  createEntity,
  type EntityStore,
  restoreEntity,
  updateEntity,
} from "../../functions/_shared/core/entity/application.ts";
import { initialEntityDefinition } from "../../functions/_shared/contracts/entity-type.ts";
import { requestActor } from "../_request.ts";
import { AppError } from "../../functions/_shared/core/shared/errors.ts";
const typeId = "10000000-0000-4000-8000-000000000001", kindId = "00000000-0000-4000-8000-000000000001";
function fixture() {
  const definition = {
    ...initialEntityDefinition("이름", { id: typeId }),
    type_id: typeId,
    schema_version: 1,
    type_version: 1,
    type: { id: typeId, label: "자료", icon_id: "box", archived: false },
    identifier_kinds: [{
      id: kindId,
      source: "app",
      label: "번호",
      source_label: "앱",
      active: true,
      generation: "automatic" as const,
      version: 1,
      source_version: 1,
    }],
  };
  let row: any = null, issued = 0;
  const store = {
    definition: () => Promise.resolve(definition),
    issueDataId: () => Promise.resolve(String(++issued)),
    executeRequest: <T>(_r: unknown, fn: () => Promise<T>) => fn(),
    get: () => Promise.resolve(row),
    insert: (input: any) =>
      Promise.resolve(row = { ...input, version: 1, deleted_at: null, title: "이름", tag_ids: [] }),
    update: (_id: string, input: any) => Promise.resolve(row = { ...row, ...input, version: row.version + 1 }),
    restore: (_id: string, input: any) =>
      Promise.resolve(row = { ...row, ...input, version: row.version + 1, deleted_at: null }),
    appendChange: () => Promise.resolve(),
  } as unknown as EntityStore;
  return {
    definition,
    deps: { uow: { run: (_a: unknown, fn: (s: EntityStore) => unknown) => fn(store) } } as any,
    actor: requestActor({ userId: crypto.randomUUID() }),
    get row() {
      return row;
    },
    get issued() {
      return issued;
    },
  };
}
Deno.test("selected property generates once, derives reference, and remains immutable on update", async () => {
  const f = fixture();
  const created = await createEntity(f.deps, f.actor, {
    entity_type_id: typeId,
    schema_version: 1,
    properties: { prop_1: "이름" },
  });
  assertEquals(created.id, `${typeId}:${kindId}:1`);
  assertEquals(created.properties.prop_2, `${kindId}:1`);
  await updateEntity(f.deps, f.actor, created.id, {
    schema_version: 1,
    expected_version: 1,
    properties: { prop_1: "변경" },
  });
  assertEquals(f.issued, 1);
  await assertRejects(
    () =>
      updateEntity(f.deps, f.actor, created.id, {
        schema_version: 1,
        expected_version: 2,
        properties: { prop_2: `${kindId}:2` },
      }),
    AppError,
  );
});
Deno.test("explicit restore preserves stopped selected pair and omitted ordinary properties", async () => {
  const f = fixture();
  const created = await createEntity(f.deps, f.actor, {
    entity_type_id: typeId,
    schema_version: 1,
    properties: { prop_1: "보존", prop_2: `${kindId}:001` },
  });
  f.row.deleted_at = "2026-10-22T00:00:00Z";
  f.definition.identifier_kinds[0].active = false;
  const restored = await restoreEntity(f.deps, f.actor, created.id, { schema_version: 1, expected_version: 1 });
  assertEquals(restored.properties, { prop_1: "보존", prop_2: `${kindId}:001` });
  assertEquals(f.issued, 0);
});
Deno.test("ordinary optional identifiers stay absent and explicit generation permits repeated values", async () => {
  const f = fixture();
  f.definition.schema.properties.prop_3 = {
    type: ["string", "null"],
    "x-order": 30,
    "x-identifier": { allowed_kind_ids: [kindId], default_kind_id: kindId },
  };
  const created = await createEntity(f.deps, f.actor, {
    entity_type_id: typeId,
    schema_version: 1,
    properties: { prop_1: "이름", prop_2: `${kindId}:001` },
  });
  assertEquals(created.properties.prop_3, undefined);
  const changed = await updateEntity(f.deps, f.actor, created.id, {
    schema_version: 1,
    expected_version: 1,
    generate_identifiers: { prop_3: kindId },
  });
  assertEquals(changed.properties.prop_3, `${kindId}:1`);
  await assertRejects(
    () =>
      updateEntity(f.deps, f.actor, created.id, {
        schema_version: 1,
        expected_version: 2,
        properties: { prop_3: `${kindId}:2` },
        generate_identifiers: { prop_3: kindId },
      }),
    AppError,
  );
});

Deno.test("HTTP and MCP use explicit restore and read-only identifier lookup, rejecting retired create fields", async () => {
  const f = fixture();
  const { Hono } = await import("hono");
  const { entityRoutes } = await import("../../functions/_shared/adapters/http/entity-routes.ts");
  const { entityTools } = await import("../../functions/_shared/adapters/mcp/entity-tools.ts");
  const { toErrorBody } = await import("../../functions/_shared/adapters/errors.ts");
  const app = new Hono<import("../../functions/_shared/adapters/http/input.ts").HttpEnv>();
  app.use("*",async (c,next) => {c.set("actor",f.actor); await next();});
  app.onError((error,c) => {const mapped = toErrorBody(error); return new Response(JSON.stringify(mapped.body),{status:mapped.status,headers:{"content-type":"application/json"}});});
  app.route("/",entityRoutes(f.deps));
  const lookup = await app.request(`/entities/lookup?entity_type_id=${typeId}&identifier=${encodeURIComponent(`${kindId}:001`)}`);
  assertEquals([lookup.status,await lookup.json(),f.issued],[200,null,0]);
  const legacy = await app.request("/entities",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({entity_type_id:typeId,schema_version:1,properties:{prop_1:"名前"},source:"app",external_id:"001"})});
  assertEquals(legacy.status,400);
  const created = await createEntity(f.deps,f.actor,{entity_type_id:typeId,schema_version:1,properties:{prop_1:"保存",prop_2:`${kindId}:001`}});
  f.row.deleted_at = "2026-10-22T00:00:00Z";
  const tool = entityTools(f.deps).find(t => t.name === "restore_entity")!;
  const restored = await tool.handler({request_key:crypto.randomUUID(),id:created.id,schema_version:1,expected_version:1},f.actor) as import("../../functions/_shared/contracts/entity.ts").EntityValues;
  assertEquals([restored.id,restored.deleted_at,f.issued],[created.id,null,0]);
});

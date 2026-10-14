import { identityFixture } from "../_entity-identity.ts";
import { assertEquals, assertRejects } from "@std/assert";
import {
  createEntity,
  type EntityDeps,
  type EntityStore,
  updateEntity,
} from "../../functions/_shared/core/entity/application.ts";
import type { EntityValues } from "../../functions/_shared/contracts/entity.ts";
import { initialEntityDefinition } from "../../functions/_shared/contracts/entity-type.ts";
import { AppError } from "../../functions/_shared/core/shared/errors.ts";
import { requestActor } from "../_request.ts";
import { Hono } from "hono";
import type { HttpEnv } from "../../functions/_shared/adapters/http/input.ts";
import { entityRoutes } from "../../functions/_shared/adapters/http/entity-routes.ts";
import { entityTools } from "../../functions/_shared/adapters/mcp/entity-tools.ts";
import { toErrorBody } from "../../functions/_shared/adapters/errors.ts";
Deno.test("Typed entity usecase validates the final patch, uses defaults only at creation and preserves stored type", async () => {
  const typeId = crypto.randomUUID();
  const definition = initialEntityDefinition("이름");
  definition.schema.properties.prop_2 = { type: ["integer", "null"], default: 7 };
  definition.display.order.push("prop_2");
  const state: { row: EntityValues | null } = { row: null };
  const store = {
    executeRequest: (_: unknown, run: () => unknown) => run(),
    definition: () =>
      Promise.resolve({
        ...definition,
        type_id: typeId,
        schema_version: 1,
        type_version: 1,
        type: { id: typeId, label: "재료", icon_id: "leaf", archived: false },
      }),
    getTypeIdentity: () => Promise.resolve(identityFixture(typeId)),
    get: () => Promise.resolve(state.row),
    insert: (i: Parameters<EntityStore["insert"]>[0]) =>
      Promise.resolve(
        state.row = {
          ...i,
          tag_ids: i.tag_ids ?? [],
          source_label: i.source,
          type: { id: typeId, label: "재료", icon_id: "leaf", archived: false },
          created_at: "2026-10-12T00:00:00Z",
          updated_at: "2026-10-12T00:00:00Z",
          current_schema_version: 1,
          title: String(i.properties.prop_1),
          display_properties: { prop_1: i.properties.prop_1 },
          version: 1,
          deleted_at: null,
        },
      ),
    update: (_: unknown, patch: Parameters<EntityStore["update"]>[1]) =>
      Promise.resolve(state.row = { ...state.row!, ...patch, version: state.row!.version + 1 }),
    appendChange: () => Promise.resolve(),
  } as unknown as EntityStore;
  const deps: EntityDeps = { uow: { run: (_actor, run) => run(store) } };
  const actor = requestActor({ userId: crypto.randomUUID() });
  await createEntity(deps, actor, {
    entity_type_id: typeId,
    schema_version: 1,
    properties: { prop_1: "재료" },
    external_id: "한글/%",
  });
  assertEquals(state.row!.properties, { prop_1: "재료", prop_2: 7 });
  await updateEntity(deps, actor, state.row!.id, {
    schema_version: 1,
    expected_version: 1,
    properties: { prop_2: null },
  });
  assertEquals(state.row!.properties, { prop_1: "재료", prop_2: null });
  const error = await assertRejects(
    () =>
      updateEntity(deps, actor, state.row!.id, { schema_version: 1, expected_version: 2, properties: { prop_2: 1.5 } }),
    AppError,
  );
  assertEquals(error.fields?.[0].path, "properties.prop_2");
  assertEquals(state.row!.version, 2);
  for (const value of ["bad\u0000text", "bad\uD800text", "bad\uDC00text"]) {
    const storageError = await assertRejects(
      () =>
        updateEntity(deps, actor, state.row!.id, {
          schema_version: 1,
          expected_version: 2,
          properties: { prop_1: value },
        }),
      AppError,
    );
    assertEquals(storageError.fields?.[0].path, "properties.prop_1");
  }
  const emoji = await updateEntity(deps, actor, state.row!.id, {
    schema_version: 1,
    expected_version: 2,
    properties: { prop_1: "😀".repeat(4096) },
  });
  assertEquals(emoji.properties.prop_1, "😀".repeat(4096));
  assertEquals(
    (await assertRejects(() =>
      updateEntity(deps, actor, state.row!.id, {
        schema_version: 2,
        expected_version: 3,
        properties: { prop_1: "new" },
      }), AppError)).code,
    "schema_changed",
  );
});

Deno.test("Typed HTTP/MCP handlers reject immutable type and retired inputs/filters before writes", async () => {
  let writes = 0;
  const deps = {
    uow: {
      run: () => {
        writes++;
        throw new Error("invalid request entered storage");
      },
    },
  };
  const actor = { userId: crypto.randomUUID() }, app = new Hono<HttpEnv>();
  app.use("*", async (c, next) => {
    c.set("actor", requestActor(actor));
    await next();
  });
  app.onError((e, c) => {
    const result = toErrorBody(e);
    return c.json(result.body, result.status as 400);
  });
  app.route("/", entityRoutes(deps));
  const tools = entityTools(deps);
  const call = (name: string, input: Record<string, unknown>) =>
    tools.find((t) => t.name === name)!.handler({
      ...input,
      ...(name.startsWith("list_") ? {} : { request_key: crypto.randomUUID() }),
    }, actor);
  const body = {
    schema_version: 1,
    expected_version: 1,
    entity_type_id: crypto.randomUUID(),
    properties: { prop_1: "other type" },
  };
  const patch = await app.request("/entities/app:001", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  assertEquals((await patch.json()).code, "entity_type_immutable");
  assertEquals(
    (await assertRejects(async () => await call("update_entity", { id: "app:001", ...body }), AppError)).code,
    "entity_type_immutable",
  );
  assertEquals((await app.request("/entities?prop4=a")).status, 400);
  assertEquals(
    (await assertRejects(async () => await call("list_entities", { prop4: "a" }), AppError)).code,
    "invalid_input",
  );
  const legacy = {
    entity_type_id: body.entity_type_id,
    schema_version: 1,
    properties: { prop_1: "typed" },
    prop1: "old",
  };
  const create = await app.request("/entities", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(legacy),
  });
  assertEquals(create.status, 400);
  assertEquals((await assertRejects(async () => await call("create_entity", legacy), AppError)).code, "invalid_input");
  assertEquals(writes, 0);
});

import { requestActor } from "../_request.ts";
import { assert, assertEquals, assertRejects } from "@std/assert";
import {
  entityCreate,
  entityListQuery,
  entityUpdate,
  type EntityValues,
} from "../../functions/_shared/contracts/entity.ts";
import {
  createEntity,
  deleteEntity,
  type EntityDeps,
  type EntityStore,
  getEntity,
  listEntities,
  updateEntity,
} from "../../functions/_shared/core/entity/application.ts";
import { entityRoutes } from "../../functions/_shared/adapters/http/entity-routes.ts";
import { entityTools } from "../../functions/_shared/adapters/mcp/entity-tools.ts";
import { toErrorBody } from "../../functions/_shared/adapters/errors.ts";
import { Hono } from "hono";
import type { HttpEnv } from "../../functions/_shared/adapters/http/input.ts";
import { AppError } from "../../functions/_shared/core/shared/errors.ts";
const A = { userId: crypto.randomUUID() }, B = { userId: crypto.randomUUID() };
import { initialEntityDefinition } from "../../functions/_shared/contracts/entity-type.ts";
const entity_type_id = crypto.randomUUID();
const definition = initialEntityDefinition("이름");
Object.assign(definition.schema.properties, {
  prop_3: { "x-order": 30, type: ["integer", "null"] },
  prop_4: { "x-order": 40, type: ["string", "null"], format: "date" },
  prop_5: { "x-order": 50, type: "string", oneOf: ["a", "b", "c"].map((value) => ({ const: value })), default: "a" },
});

const type = { id: entity_type_id, label: "재료", icon_id: "leaf", archived: false };
function memory() {
  const rows = new Map<string, EntityValues>();
  let writes = 0;
  const store: EntityStore = {
    definition: () =>
      Promise.resolve({
        ...definition,
        type,
        type_id: entity_type_id,
        type_version: 1,
        schema_version: 1,
        identifier_kinds: [{
          id: "00000000-0000-4000-8000-000000000001",
          source: "app",
          label: "번호",
          source_label: "앱",
          active: true,
          generation: "automatic" as const,
          version: 1,
          source_version: 1,
        }],
      }),
    executeRequest: <T>(_request: unknown, execute: () => Promise<T>) => execute(),
    issueDataId: () => Promise.resolve(crypto.randomUUID()),
    restore: (id, changes) => {
      const row = { ...rows.get(id)!, ...changes, deleted_at: null, version: rows.get(id)!.version + 1 };
      rows.set(id, row);
      return Promise.resolve(row);
    },
    appendChange: () => Promise.resolve(),
    get: (id) => Promise.resolve(rows.get(id) ?? null),
    related: () =>
      Promise.resolve({
        tasks: { count: 0, items: [] },
        records: { count: 0, items: [] },
      }),
    insert: (input) => {
      if (rows.has(input.id)) throw new AppError("conflict", "이미 존재하는 ID입니다.");
      writes++;
      const row = {
        ...input,
        tag_ids: [],
        id: input.id ?? crypto.randomUUID(),
        identity_label: "앱 · 번호",
        type,
        current_schema_version: 1,
        title: String(input.properties.prop_1),

        deleted_at: null,
        version: 1,
        created_at: "2026-10-04T00:00:00.000Z",
        updated_at: "2026-10-04T00:00:00.000Z",
      };
      rows.set(row.id, row);
      return Promise.resolve(row);
    },
    update: (id, changes) => {
      writes++;
      const row = { ...rows.get(id)!, ...changes, version: rows.get(id)!.version + 1 };
      rows.set(id, row);
      return Promise.resolve(row);
    },
    delete: (id) => {
      writes++;
      rows.set(id, { ...rows.get(id)!, deleted_at: "2026-10-09T00:00:00.000Z", version: rows.get(id)!.version + 1 });
      return Promise.resolve();
    },
    list: (q, after) =>
      Promise.resolve(
        [...rows.values()].filter((e) => !e.deleted_at).sort((a, b) => b.id.localeCompare(a.id)).filter((e) =>
          !after || e.id < after.id
        ).slice(
          0,
          q.limit,
        ),
      ),
  };
  const d: EntityDeps = { uow: { run: (_a, fn) => fn(store) } };
  return { d, writes: () => writes };
}
Deno.test("Entity application: 멱등 serial retry·버전 거부 무쓰기·한글 커서/owner/filter 검사", async () => {
  const { d, writes } = memory(),
    input = entityCreate.parse({
      entity_type_id,
      schema_version: 1,
      properties: { prop_1: "한글 😀", prop_2: "00000000-0000-4000-8000-000000000001:001" },
    });
  const e = await createEntity(d, requestActor(A), input);
  assertEquals((await assertRejects(() => createEntity(d, requestActor(A), input), AppError)).code, "conflict");
  assertEquals(writes(), 1);
  assertEquals(
    (await assertRejects(
      () => createEntity(d, requestActor(A), { ...input, properties: { ...input.properties, prop_1: "다른 내용" } }),
      AppError,
    )).code,
    "conflict",
  );
  await assertRejects(
    () =>
      updateEntity(
        d,
        requestActor(A),
        e.id,
        entityUpdate.parse({
          schema_version: 1,
          change_note: "테스트 변경 이유",
          expected_version: 2,
          properties: { prop_3: 0 },
        }),
      ),
    AppError,
  );
  await assertRejects(() => deleteEntity(d, requestActor(A), e.id, 2), AppError);
  assertEquals(writes(), 1);
  const changed = await updateEntity(
    d,
    requestActor(A),
    e.id,
    entityUpdate.parse({
      schema_version: 1,
      change_note: "테스트 변경 이유",
      expected_version: 1,
      properties: { prop_3: 0 },
    }),
  );
  assertEquals(changed.properties.prop_3, 0);
  await createEntity(
    d,
    requestActor(A),
    entityCreate.parse({
      entity_type_id,
      schema_version: 1,
      properties: { prop_1: "둘째" },
    }),
  );
  const q = entityListQuery.parse({ limit: 1 }), first = await listEntities(d, A, q);
  assert(first.next_cursor);
  const tail = await listEntities(d, A, { ...q, cursor: first.next_cursor });
  assertEquals(tail.items.length, 1);
  for (const [actor, extra] of [[B, {}], [A, { keyword: "다른 조건" }]] as const) {
    assertEquals(
      (await assertRejects(() => listEntities(d, actor, { ...q, ...extra, cursor: first.next_cursor! }), AppError))
        .code,
      "invalid_input",
    );
  }
  await deleteEntity(d, requestActor(A), e.id, 2);
  assert((await getEntity(d, A, e.id)).deleted_at);
});
Deno.test("Entity HTTP/MCP 실제 handler: CRUD parity·엄격 입력·존재 비공개·버전 무쓰기", async () => {
  const { d, writes } = memory();
  const app = new Hono<HttpEnv>();
  app.use("*", async (c, next) => {
    c.set("actor", { ...A, request: { key: c.req.header("Idempotency-Key") ?? crypto.randomUUID() } });
    await next();
  });
  app.route("/", entityRoutes(d));
  app.onError((e, c) => {
    const r = toErrorBody(e);
    return c.json(r.body, r.status as 400);
  });
  const tools = entityTools(d),
    tool = (name: string, i: Record<string, unknown>) =>
      tools.find((t) => t.name === name)!.handler({
        .../^(create_|update_|delete_|rekey_)/.test(name) ? { request_key: crypto.randomUUID() } : {},
        ...i,
      }, A);
  const request = (method: string, path: string, input?: unknown) =>
    app.request(path, {
      method,
      headers: { "Idempotency-Key": crypto.randomUUID(), "content-type": "application/json" },
      body: input === undefined ? undefined : JSON.stringify(input),
    });
  assertEquals(tools.some((tool) => tool.name === "prepare_entity_registration"), false);
  assertEquals((await request("POST", "/entities/prepare", { source: "app" })).status, 404);
  assertEquals(writes(), 0);
  const res = await request("POST", "/entities", {
    entity_type_id,
    schema_version: 1,
    properties: { prop_1: "웹" },
  });
  assertEquals(res.status, 201);
  const e = await res.json();
  assertEquals((await tool("get_entity", { id: e.id }) as EntityValues).properties.prop_1, "웹");
  const before = writes();
  assertEquals(
    (await request("PATCH", `/entities/${encodeURIComponent(e.id)}`, {
      change_note: "테스트 변경 이유",
      expected_version: 1,
      owner_id: B.userId,
    })).status,
    400,
  );
  assertEquals(
    (await request("POST", `/entities/${encodeURIComponent(e.id)}/delete`, { expected_version: 2 })).status,
    409,
  );
  assertEquals(writes(), before);
  assertEquals((await request("GET", "/entities/not-id")).status, 404);
  assertEquals(
    (await assertRejects(async () => await tool("get_entity", { id: "not-id" }), AppError)).code,
    "not_found",
  );
  for (const field of ["source", "external_id", "entity_type_id"]) {
    const invalid = {
      schema_version: 1,
      expected_version: 1,
      [field]: field === "entity_type_id" ? entity_type_id : "replacement",
    };
    assertEquals((await request("PATCH", `/entities/${encodeURIComponent(e.id)}`, invalid)).status, 400);
    assertEquals(
      (await assertRejects(async () => await tool("update_entity", { id: e.id, ...invalid }), AppError)).code,
      "entity_type_immutable",
    );
    assertEquals((await tool("get_entity", { id: e.id }) as EntityValues).version, 1);
  }
  const changed = await tool("update_entity", {
    change_note: "테스트 변경 이유",
    id: e.id,
    expected_version: 1,
    schema_version: 1,
    properties: { prop_5: "c" },
  }) as EntityValues;
  assertEquals(changed.version, 2);
  assertEquals((await request("GET", `/entities/${encodeURIComponent(e.id)}`)).status, 200);
  await tool("delete_entity", { change_note: "테스트 변경 이유", id: e.id, expected_version: 2 });
  assertEquals((await request("GET", `/entities/${encodeURIComponent(e.id)}`)).status, 200);
});

Deno.test("Entity HTTP/MCP list: typed AND inputs require a type and reject coercion", async () => {
  const { d } = memory();
  const tool = entityTools(d).find((t) => t.name === "list_entities")!;
  const query = {
    entity_type_id,
    filters: [{ key: "prop_3", operator: "gte", value: 0 }],
    sort: { key: "prop_3", direction: "asc" },
  };
  assertEquals((await tool.handler(query, A) as { items: unknown[] }).items, []);
  for (
    const bad of [
      { ...query, entity_type_id: undefined },
      { filters: [] },
      { ...query, filters: [{ key: "prop_3", operator: "gte", value: "0" }] },
      { ...query, filters: [{ key: "prop_100", operator: "eq", value: 0 }] },
      { ...query, filters: [{ key: "prop_5", operator: "gte", value: "a" }] },
      {
        ...query,
        filters: [{ key: "prop_3", operator: "gt", value: 5 }, { key: "prop_3", operator: "lte", value: 5 }],
      },
      { ...query, filters: [{ key: "prop_3", operator: "eq", value: 0 }, { key: "prop_3", operator: "unset" }] },
      { ...query, filters: [{ key: "prop_3", operator: "eq", value: 0 }, { key: "prop_3", operator: "eq", value: 0 }] },
    ]
  ) {
    assertEquals((await assertRejects(() => tool.handler(bad, A), AppError)).code, "invalid_input");
  }
});

Deno.test("Entity HTTP list: structured URL filters and sorts share strict MCP semantics", async () => {
  const { d } = memory(), app = new Hono<HttpEnv>();
  app.use("*", async (c, next) => {
    c.set("actor", A);
    await next();
  });
  app.route("/", entityRoutes(d));
  app.onError((error, c) => {
    const result = toErrorBody(error);
    return c.json(result.body, result.status as 400);
  });
  const query = new URLSearchParams({
    entity_type_id,
    filters: JSON.stringify([{ key: "prop_3", operator: "gte", value: 0 }]),
    sort: JSON.stringify({ key: "prop_3", direction: "desc" }),
  });
  assertEquals((await app.request(`/entities?${query}`)).status, 200);
  query.set("filters", JSON.stringify([{ key: "prop_3", operator: "gte", value: "0" }]));
  assertEquals((await app.request(`/entities?${query}`)).status, 400);
  query.set("filters", "[");
  assertEquals((await app.request(`/entities?${query}`)).status, 400);
});

Deno.test("entity POST query is a keyless read sharing GET/MCP defaults and strict errors without writes", async () => {
  const { d, writes } = memory(), app = new Hono<HttpEnv>();
  app.use("*", async (c, next) => {
    c.set("actor", A);
    await next();
  });
  app.onError((e, c) => {
    const r = toErrorBody(e);
    return c.json(r.body, r.status as 400);
  });
  app.route("/", entityRoutes(d));
  const post = (body: unknown) =>
    app.request("/entities/query", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  const response = await post({ entity_type_id });
  assertEquals(response.status, 200);
  assertEquals(await response.json(), await (await app.request(`/entities?entity_type_id=${entity_type_id}`)).json());
  assertEquals(
    await (await post({ entity_type_id })).json(),
    await entityTools(d).find((t) => t.name === "list_entities")!.handler({ entity_type_id }, A),
  );
  for (
    const body of [
      { owner_id: "other" },
      { entity_type_id, filters: [{ key: "prop_3", operator: "eq", value: "wrong" }] },
      { entity_type_id, limit: 101 },
      { entity_type_id, cursor: "invalid" },
    ]
  ) {
    assertEquals((await post(body)).status, 400);
  }
  assertEquals(writes(), 0);
});

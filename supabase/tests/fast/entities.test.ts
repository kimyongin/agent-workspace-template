import { requestActor } from "../_request.ts";
import { assert, assertEquals, assertRejects } from "@std/assert";
import {
  entityCreate,
  entityListQuery,
  type EntityResult,
  entityUpdate,
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
function memory() {
  const rows = new Map<string, EntityResult>();
  let writes = 0;
  const store: EntityStore = {
    executeRequest: <T>(_request: unknown, execute: () => Promise<T>) => execute(),
    getBusinessSettings: () => Promise.resolve({ settings: {} }),
    restore: (id, changes) => {
      const row = { ...rows.get(id)!, ...changes, deleted_at: null, version: rows.get(id)!.version + 1 };
      rows.set(id, row);
      return Promise.resolve(row);
    },
    rekey: (id, identity) => {
      const row = {
        ...rows.get(id)!,
        ...identity,
        id: `${identity.source}:${identity.external_id}`,
        version: rows.get(id)!.version + 1,
      };
      rows.delete(id);
      rows.set(row.id, row);
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
        tag_ids: input.tag_ids ?? [],
        id: input.id ?? crypto.randomUUID(),
        source_label: input.source,
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
    input = entityCreate.parse({ source: "app", external_id: crypto.randomUUID(), ...{ prop1: "한글 😀" } });
  const e = await createEntity(d, requestActor(A), input);
  assertEquals((await assertRejects(() => createEntity(d, requestActor(A), input), AppError)).code, "conflict");
  assertEquals(writes(), 1);
  assertEquals(
    (await assertRejects(() => createEntity(d, requestActor(A), { ...input, prop1: "다른 내용" }), AppError)).code,
    "conflict",
  );
  await assertRejects(
    () =>
      updateEntity(
        d,
        requestActor(A),
        e.id,
        entityUpdate.parse({ change_note: "테스트 변경 이유", expected_version: 2, prop2: 0 }),
      ),
    AppError,
  );
  await assertRejects(() => deleteEntity(d, requestActor(A), e.id, 2), AppError);
  assertEquals(writes(), 1);
  const changed = await updateEntity(
    d,
    requestActor(A),
    e.id,
    entityUpdate.parse({ change_note: "테스트 변경 이유", expected_version: 1, prop2: 0 }),
  );
  assertEquals(changed.prop2, 0);
  await createEntity(
    d,
    requestActor(A),
    entityCreate.parse({ source: "app", external_id: crypto.randomUUID(), ...{ prop1: "둘째" } }),
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
  const res = await request("POST", "/entities", { source: "app", external_id: crypto.randomUUID(), prop1: "웹" });
  assertEquals(res.status, 201);
  const e = await res.json();
  assertEquals((await tool("get_entity", { id: e.id }) as EntityResult).prop1, "웹");
  const before = writes();
  assertEquals(
    (await request("PATCH", `/entities/${encodeURIComponent(e.id)}`, {
      change_note: "테스트 변경 이유",
      expected_version: 1,
      owner_id: B.userId,
    })).status,
    400,
  );
  assertEquals((await request("DELETE", `/entities/${encodeURIComponent(e.id)}?expected_version=2`)).status, 409);
  assertEquals(writes(), before);
  assertEquals((await request("GET", "/entities/not-id")).status, 404);
  assertEquals(
    (await assertRejects(async () => await tool("get_entity", { id: "not-id" }), AppError)).code,
    "not_found",
  );
  const changed = await tool("update_entity", {
    change_note: "테스트 변경 이유",
    id: e.id,
    expected_version: 1,
    prop4: "c",
  }) as EntityResult;
  assertEquals(changed.version, 2);
  assertEquals((await request("GET", `/entities/${encodeURIComponent(e.id)}`)).status, 200);
  await tool("delete_entity", { change_note: "테스트 변경 이유", id: e.id, expected_version: 2 });
  assertEquals((await request("GET", `/entities/${encodeURIComponent(e.id)}`)).status, 200);
});

import { assertEquals, assertRejects } from "@std/assert";
import type { PrincipleStore } from "../../functions/_shared/core/principles/ports.ts";
import type { PrincipleResult } from "../../functions/_shared/contracts/principle.ts";
import { principleRoutes } from "../../functions/_shared/adapters/http/principle-routes.ts";
import { principleTools } from "../../functions/_shared/adapters/mcp/principle-tools.ts";
import { toErrorBody } from "../../functions/_shared/adapters/errors.ts";
import { Hono } from "hono";
import type { HttpEnv } from "../../functions/_shared/adapters/http/input.ts";
import type { ChangeInput } from "../../functions/_shared/core/shared/changes.ts";
import { AppError } from "../../functions/_shared/core/shared/errors.ts";
const actor = { userId: crypto.randomUUID() }, now = "2026-10-04T01:00:00.000Z";
function fixture() {
  const rows = new Map<string, PrincipleResult>(), events: ChangeInput[] = [];
  const s: PrincipleStore = {
    current: () => Promise.resolve([...rows.values()].find((r) => r.is_current) ?? null),
    insert: (i) => {
      const r: PrincipleResult = {
        ...i,
        id: i.id,
        version: 1,
        created_at: now,
        updated_at: now,
        saved_at: now,
        is_current: true,
        origin: "saved",
        legacy_context: null,
      };
      rows.set(r.id, r);
      return Promise.resolve(r);
    },
    get: (id) => Promise.resolve(rows.get(id) ?? null),
    update: (id, i) => {
      const r = { ...rows.get(id)!, ...i, version: rows.get(id)!.version + 1 };
      rows.set(id, r);
      return Promise.resolve(r);
    },
    delete: (id) => {
      rows.delete(id);
      return Promise.resolve();
    },
    appendChange: (i) => {
      events.push(i);
      return Promise.resolve();
    },
  };
  const d = { uow: { run: <T>(_a: typeof actor, fn: (s: PrincipleStore) => Promise<T>) => fn(s) } };
  const app = new Hono<HttpEnv>();
  app.use("*", async (c, next) => {
    c.set("actor", actor);
    await next();
  });
  app.route("/", principleRoutes(d));
  app.onError((e, c) => {
    const r = toErrorBody(e);
    return c.json(r.body, r.status as 400);
  });
  const tools = principleTools(d),
    call = (name: string, i: Record<string, unknown>) =>
      tools.find((t) => t.name === name)!.handler(
        name === "create_principle" ? { id: crypto.randomUUID(), ...i } : i,
        actor,
      );
  return {
    d,
    rows,
    tools,
    events,
    call,
    http: (method: string, path: string, input?: unknown) =>
      app.request(path, {
        method,
        headers: { "content-type": "application/json" },
        body: input
          ? JSON.stringify(
            method === "POST" && path === "/principles"
              ? { id: crypto.randomUUID(), ...(input as Record<string, unknown>) }
              : input,
          )
          : undefined,
      }),
  };
}
Deno.test("retired principle history routes/tools are absent and exact reads are current-only", async () => {
  const f = fixture();
  const current = await f.call("create_principle", { title: "현재" }) as PrincipleResult;
  const historical = { ...current, id: crypto.randomUUID(), is_current: false };
  f.rows.set(historical.id, historical);
  assertEquals((await f.http("GET", "/principles?view=all")).status, 404);
  assertEquals(
    (await f.http("PATCH", `/principles/${historical.id}/correct`, { expected_version: 1, body: "정정" })).status,
    404,
  );
  assertEquals(f.tools.some((t) => ["list_principles", "correct_principle"].includes(t.name)), false);
  assertEquals((await f.http("GET", `/principles/${historical.id}`)).status, 404);
  const error = await assertRejects(() => f.call("get_principle", { id: historical.id }), AppError);
  assertEquals(error.code, "not_found");
  assertEquals(await (await f.http("GET", `/principles/${current.id}`)).json(), current);
  assertEquals(f.rows.get(historical.id), historical);
});
Deno.test("principle preview endpoints and tools are removed", async () => {
  const f = fixture();
  assertEquals((await f.http("POST", "/principles/preview", {})).status, 404);
  assertEquals(f.tools.some((t) => t.name.startsWith("preview_")), false);
});
Deno.test("HTTP current principle edited through MCP retains its document identity", async () => {
  const f = fixture();
  const web = await f.http("POST", "/principles", {
    title: "현재 기준",
    body: "초기 본문",
  });
  assertEquals(web.status, 201);
  const first = await web.json();
  const saved = await f.call("update_principle", {
    id: first.id,
    title: "현재 기준",
    body: "새 본문",
    expected_version: first.version,
    change_note: "검토 반영",
  }) as PrincipleResult;
  assertEquals(saved.id, first.id);
  assertEquals(saved.body, "새 본문");
  const read = await f.http("GET", "/principles/current");
  assertEquals((await read.json()).current, saved);
});
Deno.test("current principle deletion leaves none and stale requests cannot overwrite its replacement", async () => {
  const f = fixture(),
    first = await f.call("create_principle", { title: "첫 기준" }) as PrincipleResult;
  const next = await f.call("update_principle", {
    id: first.id,
    title: "수정 기준",
    expected_version: first.version,
  }) as PrincipleResult;
  assertEquals(next.id, first.id);
  assertEquals(next.version, 2);
  await f.call("delete_principle", { id: next.id, expected_version: next.version });
  assertEquals(await f.call("get_current_principle", {}), { current: null });
  const replacement = await f.call("create_principle", { title: "다시 등록" }) as PrincipleResult;
  assertEquals(replacement.version, 1);
  const stale = await f.http("PATCH", `/principles/${next.id}`, {
    title: "과거 요청",
    expected_version: next.version,
  });
  assertEquals(stale.status, 404);
  assertEquals((await f.http("GET", `/principles/${next.id}`)).status, 404);
});
Deno.test("current principle HTTP/MCP input/result parity and removed activation rejected", async () => {
  const f = fixture();
  const r = await f.http("POST", "/principles", { title: "기준" });
  assertEquals(r.status, 201);
  const current = await r.json();
  assertEquals(await f.call("get_current_principle", {}), { current });
  const invalid = { title: "새", expected_version: current.version, owner_id: crypto.randomUUID() };
  const bad = await f.http("PATCH", `/principles/${current.id}`, invalid);
  assertEquals(bad.status, 400);
  const error = await assertRejects(
    async () => await f.call("update_principle", { id: current.id, ...invalid }),
    AppError,
  );
  assertEquals((await bad.json()).code, error.code);
  assertEquals((await f.http("POST", `/principles/${current.id}/activate`, { expected_version: 1 })).status, 404);
  const note = {
    title: "새",
    expected_version: 1,
    change_note: "이유",
  };
  const saved = await f.http("PATCH", `/principles/${current.id}`, note);
  const next = await saved.json();
  await assertRejects(() => f.call("update_principle", { id: current.id, ...note }), AppError);
  assertEquals((await f.call("get_current_principle", {}) as { current: PrincipleResult }).current, next);
  assertEquals(f.events.length, 2);
});

Deno.test("principle patch retains omitted content and no-op/retry/conflict leave the next revision unchanged", async () => {
  const f = fixture();
  const input = { title: "기준", body: "원래 본문" };
  const first = await f.call("create_principle", input) as PrincipleResult;
  await assertRejects(() => f.call("create_principle", input), AppError);
  const exists = await assertRejects(() => f.call("create_principle", { title: "새 기준" }), AppError);
  assertEquals(exists.code, "conflict");
  const patch = { id: first.id, title: "변경 기준", expected_version: first.version };
  const next = await f.call("update_principle", patch) as PrincipleResult;
  assertEquals([next.id, next.title, next.body, next.version], [
    first.id,
    "변경 기준",
    "원래 본문",
    2,
  ]);
  await assertRejects(() => f.call("update_principle", patch), AppError);
  const noop = { id: next.id, title: next.title, expected_version: next.version, change_note: "메모만 변경" };
  assertEquals(await f.call("update_principle", noop), next);
  const stale = await f.http("PATCH", `/principles/${next.id}`, { title: next.title, expected_version: first.version });
  assertEquals(stale.status, 409);
  assertEquals(f.events.length, 2);
  const updated = await f.call("update_principle", {
    id: next.id,
    body: "새 본문",
    expected_version: next.version,
  }) as PrincipleResult;
  assertEquals(updated.version, 3);
  assertEquals(f.events.length, 3);
  assertEquals(await f.call("get_current_principle", {}), { current: updated });
});

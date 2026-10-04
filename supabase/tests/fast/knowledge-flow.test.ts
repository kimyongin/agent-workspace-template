import { assert, assertEquals, assertRejects } from "@std/assert";
import type { PrincipleStore } from "../../functions/_shared/core/principles/ports.ts";
import type { PrincipleResult } from "../../functions/_shared/contracts/principle.ts";
import { principleCreate, principleSave, principleUpdate } from "../../functions/_shared/contracts/principle.ts";
import * as p from "../../functions/_shared/core/principles/application.ts";
import { principleRoutes } from "../../functions/_shared/adapters/http/principle-routes.ts";
import { principleTools } from "../../functions/_shared/adapters/mcp/principle-tools.ts";
import { toErrorBody } from "../../functions/_shared/adapters/errors.ts";
import { Hono } from "hono";
import type { HttpEnv } from "../../functions/_shared/adapters/http/input.ts";
import type { ChangeInput } from "../../functions/_shared/core/shared/changes.ts";
import { AppError } from "../../functions/_shared/core/shared/errors.ts";
const actor = { userId: crypto.randomUUID() }, now = "2026-10-04T01:00:00.000Z";
function fixture() {
  let revision = 0;
  const rows = new Map<string, PrincipleResult>(),
    events: ChangeInput[] = [],
    requests = new Map<string, { request_hash: string; response: unknown }>();
  const s: PrincipleStore = {
    lockRequest: () => Promise.resolve(),
    findRequest: (op, id) => Promise.resolve(requests.get(op + id) ?? null),
    saveRequest: (op, id, request_hash, response) => {
      requests.set(op + id, { request_hash, response });
      return Promise.resolve();
    },
    lockCurrent: () => Promise.resolve(),
    nextVersion: () => Promise.resolve(revision = Math.max(revision, ...[...rows.values()].map((r) => r.version)) + 1),
    current: () => Promise.resolve([...rows.values()].find((r) => r.is_current) ?? null),
    insert: (i, v = 1) => {
      const r: PrincipleResult = {
        ...i,
        id: crypto.randomUUID(),
        version: v,
        created_at: now,
        updated_at: now,
        saved_at: now,
        is_current: true,
        change_note: i.change_note ?? null,
        origin: "saved",
        legacy_context: null,
        entity_id: null,
        tag_ids: [],
        applies_when: "",
        status: "active",
        replaced_by_id: null,
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
    retire: (id) => {
      rows.get(id)!.is_current = false;
      return Promise.resolve();
    },
    delete: (id) => {
      rows.delete(id);
      return Promise.resolve();
    },
    promoteLatest: (version) => {
      const r = [...rows.values()].at(-1);
      if (r) {
        r.is_current = true;
        r.version = version;
      }
      return Promise.resolve();
    },
    list: () => Promise.resolve([...rows.values()]),
    enqueueIndex: () => Promise.resolve(),
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
    call = (name: string, i: Record<string, unknown>) => tools.find((t) => t.name === name)!.handler(i, actor);
  return {
    d,
    events,
    call,
    http: (method: string, path: string, input?: unknown) =>
      app.request(path, {
        method,
        headers: { "content-type": "application/json" },
        body: input ? JSON.stringify(input) : undefined,
      }),
  };
}
Deno.test("current principle application: mandatory reason/version, save new id, no-op no event, correction/current separation", async () => {
  const f = fixture(), content = { title: "기준", summary: "요약", body: "본문" };
  const first = await p.createPrinciple(f.d, actor, principleCreate.parse(content));
  await assertRejects(
    () => p.saveCurrentPrinciple(f.d, actor, principleSave.parse({ ...content, expected_version: 1, body: "다름" })),
    AppError,
  );
  assertEquals(
    (await p.saveCurrentPrinciple(
      f.d,
      actor,
      principleSave.parse({ ...content, expected_version: 1, change_note: "동일" }),
    )).id,
    first.id,
  );
  assertEquals(f.events.length, 1);
  const next = await p.saveCurrentPrinciple(
    f.d,
    actor,
    principleSave.parse({ ...content, expected_version: 1, body: "새 본문", change_note: "정책" }),
  );
  assert(next.id !== first.id);
  assertEquals(next.version, 2);
  await p.correctPrinciple(
    f.d,
    actor,
    first.id,
    principleUpdate.parse({ expected_version: 1, body: "오타", change_note: "정정" }),
  );
  assertEquals((await p.currentPrinciple(f.d, actor)).current!.id, next.id);
  assertEquals(f.events.length, 3);
});
Deno.test("current principle HTTP/MCP input/result parity and removed activation rejected", async () => {
  const f = fixture();
  const r = await f.http("POST", "/principles/current", { title: "기준", summary: "요약" });
  assertEquals(r.status, 201);
  const current = await r.json();
  assertEquals(await f.call("get_current_principle", {}), { current });
  const invalid = { title: "새", summary: "요약", expected_version: current.version };
  const bad = await f.http("POST", "/principles/current", invalid);
  assertEquals(bad.status, 400);
  const error = await assertRejects(() => f.call("save_current_principle", invalid), AppError);
  assertEquals((await bad.json()).code, error.code);
  assertEquals((await f.http("POST", `/principles/${current.id}/activate`, { expected_version: 1 })).status, 404);
  const note = {
    title: "새",
    summary: "요약",
    expected_version: 1,
    change_note: "이유",
    request_id: crypto.randomUUID(),
  };
  const saved = await f.http("POST", "/principles/current", note);
  const next = await saved.json();
  assertEquals(await f.call("save_current_principle", note), next);
  assertEquals(f.events.length, 2);
});

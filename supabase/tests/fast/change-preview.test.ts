import { assertEquals } from "@std/assert";
import { Hono } from "hono";
import { entityRoutes } from "../../functions/_shared/adapters/http/entity-routes.ts";
import type { EntityDeps, EntityStore } from "../../functions/_shared/core/entity/application.ts";
import type { HttpEnv } from "../../functions/_shared/adapters/http/input.ts";
import { toErrorBody } from "../../functions/_shared/adapters/errors.ts";

Deno.test("entity preview shows current facts without storing; stale and foreign targets are refused", async () => {
  const id = crypto.randomUUID(), actor = { userId: crypto.randomUUID() };
  const current = {
    id,
    prop1: "상담 고객",
    prop2: 10,
    prop3: null,
    prop4: "a" as const,
    tag_ids: [],
    version: 3,
    created_at: "2026-10-06T00:00:00Z",
    updated_at: "2026-10-06T00:00:00Z",
  };
  const store = new Proxy({ get: (key: string) => Promise.resolve(key === id ? current : null) }, {
    get: (s, key) =>
      Reflect.get(s, key) ?? (() => {
        throw Error("Preview must not mutate");
      }),
  }) as unknown as EntityStore;
  const deps: EntityDeps = { uow: { run: (_a, fn) => fn(store) } };
  const app = new Hono<HttpEnv>();
  app.use("*", async (c, next) => {
    c.set("actor", actor);
    await next();
  });
  app.route("/", entityRoutes(deps));
  app.onError((e, c) => {
    const r = toErrorBody(e);
    return c.json(r.body, r.status as 400);
  });
  const request = (target: string, version: number) =>
    app.request("/entities/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "update", id: target, input: { expected_version: version, prop2: 20 } }),
    });
  const response = await request(id, 3);
  assertEquals(response.status, 200);
  const preview = await response.json();
  assertEquals(preview.memo.title, "상담 고객 수정");
  assertEquals(preview.memo.body, "속성 2: 10 → 20");
  assertEquals(preview.changed, true);
  assertEquals((await request(id, 2)).status, 409);
  assertEquals((await request(crypto.randomUUID(), 3)).status, 404);
});

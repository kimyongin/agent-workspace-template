import { assertEquals } from "@std/assert";
import { Hono } from "hono";
import { activityRoutes } from "../../functions/_shared/adapters/http/activity-routes.ts";
import { activityTools } from "../../functions/_shared/adapters/mcp/activity-tools.ts";
import type { HttpEnv } from "../../functions/_shared/adapters/http/input.ts";
import type { ActivityDeps } from "../../functions/_shared/core/activity/application.ts";
import { toErrorBody } from "../../functions/_shared/adapters/errors.ts";
import { notFound } from "../../functions/_shared/core/shared/errors.ts";

Deno.test("HTTP/MCP external status: readonly current-owner use case exposes stable references with no write key", async () => {
  const actor = { userId: crypto.randomUUID() }, id = "20261011-ABCDEF12", effect_id = crypto.randomUUID();
  const effects = [{
    effect_id,
    state: "unknown" as const,
    attempts: 1,
    reason: "provider_unknown" as const,
    start: 0,
    end: 4,
  }];
  const deps: ActivityDeps = {
    clock: { now: () => new Date() },
    uow: {
      run: () => {
        throw Error("write transaction");
      },
    },
    effectStatus: {
      forRecord: (who, record) => {
        assertEquals(who.userId, actor.userId);
        if (record !== id) throw notFound();
        return Promise.resolve(effects);
      },
    },
  };
  const app = new Hono<HttpEnv>();
  app.use("*", async (c, next) => {
    c.set("actor", actor);
    await next();
  });
  app.route("/", activityRoutes(deps));
  app.onError((e, c) => {
    const r = toErrorBody(e);
    return c.json(r.body, r.status as 400);
  });
  const response = await app.request(`/records/${id}/index-effects`);
  assertEquals(response.status, 200);
  assertEquals(await response.json(), effects);
  const tool = activityTools(deps).find((t) => t.name === "get_record_index_effects")!;
  assertEquals(tool.readOnly, true);
  assertEquals(await tool.handler({ id }, actor), { items: effects });
  assertEquals(tool.input.safeParse({ id, request_key: crypto.randomUUID() }).success, false);
  assertEquals((await app.request(`/records/${crypto.randomUUID()}/index-effects`)).status, 404);
});

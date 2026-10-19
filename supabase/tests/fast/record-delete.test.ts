import { assertEquals, assertRejects } from "@std/assert";
import { z } from "zod";
import { Hono } from "hono";
import { activityTools } from "../../functions/_shared/adapters/mcp/activity-tools.ts";
import { activityRoutes } from "../../functions/_shared/adapters/http/activity-routes.ts";
import type { HttpEnv } from "../../functions/_shared/adapters/http/input.ts";
import { toErrorBody } from "../../functions/_shared/adapters/errors.ts";
import { AppError } from "../../functions/_shared/core/shared/errors.ts";

Deno.test("record deletion accepts only identity/version and rejects change metadata before storage", async () => {
  const actor = { userId: crypto.randomUUID() }, id = crypto.randomUUID();
  const deps = {
    clock: { now: () => new Date() },
    uow: {
      run: () => {
        throw Error("Invalid input must not reach storage");
      },
    },
  };
  const tool = activityTools(deps).find((t) => t.name === "delete_record")!;
  const schema = z.toJSONSchema(tool.input, { io: "input" });
  assertEquals(Object.keys(schema.properties ?? {}).sort(), [
    "expected_version",
    "id",
    "request_key",
  ]);
  const app = new Hono<HttpEnv>();
  app.use("*", async (c, next) => {
    c.set("actor", { ...actor, request: { key: c.req.header("Idempotency-Key") ?? crypto.randomUUID() } });
    await next();
  });
  app.route("/", activityRoutes(deps));
  app.onError((e, c) => {
    const r = toErrorBody(e);
    return c.json(r.body, r.status as 400);
  });
  for (
    const metadata of [
      { change_memo: { title: "삭제", body: "미사용" } },
      { change_note: "미사용 설명" },
      { change_note: "" },
      { change_tag_ids: [] },
      { change_tag_ids: ["20261016-ABCDEFGH"] },
    ]
  ) {
    const input = { request_key: crypto.randomUUID(), id, expected_version: 1, ...metadata };
    assertEquals(tool.input.safeParse(input).success, false);
    const error = await assertRejects(async () => await tool.handler(input, actor), AppError);
    assertEquals(error.code, "invalid_input");
    const query = new URLSearchParams({ expected_version: "1" });
    for (const [key, value] of Object.entries(metadata)) {
      query.set(key, typeof value === "string" ? value : JSON.stringify(value));
    }
    const res = await app.request(`/records/${id}?${query}`, { method: "DELETE" });
    assertEquals(res.status, 400);
    assertEquals((await res.json()).code, "invalid_input");
  }
});

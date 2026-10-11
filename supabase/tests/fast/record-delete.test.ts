import { assertEquals, assertRejects } from "@std/assert";
import { z } from "zod";
import { Hono } from "hono";
import { activityTools } from "../../functions/_shared/adapters/mcp/activity-tools.ts";
import { activityRoutes } from "../../functions/_shared/adapters/http/activity-routes.ts";
import type { HttpEnv } from "../../functions/_shared/adapters/http/input.ts";
import { toErrorBody } from "../../functions/_shared/adapters/errors.ts";
import { AppError } from "../../functions/_shared/core/shared/errors.ts";

Deno.test("record deletion rejects unsupported final memo before storage and does not advertise it", async () => {
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
    "change_note",
    "change_tag_ids",
    "expected_version",
    "id",
    "request_key",
  ]);
  await assertRejects(
    () =>
      tool.handler({
        request_key: crypto.randomUUID(),
        ...{ id, expected_version: 1, change_memo: { title: "삭제", body: "미사용" } },
      }, actor),
    AppError,
  );
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
  const res = await app.request(`/records/${id}?expected_version=1&change_memo=unsupported`, { method: "DELETE" });
  assertEquals(res.status, 400);
  assertEquals((await res.json()).code, "invalid_input");
});

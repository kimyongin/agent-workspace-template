import { Hono } from "hono";
import { type HttpEnv, json } from "./input.ts";
import { type CreateAndLinkDeps, createAndLinkEntity } from "../../core/entity-relations/create-and-link.ts";
export function createAndLinkRoutes(d: CreateAndLinkDeps) {
  const app = new Hono<HttpEnv>();
  app.post(
    "/entity-relations/:definition_id/:side/:origin_id/create-and-link",
    async (c) =>
      c.json(
        await createAndLinkEntity(d, c.get("actor"), {
          ...await json(c.req.raw) as object,
          definition_id: c.req.param("definition_id"),
          side: Number(c.req.param("side")),
          origin_id: c.req.param("origin_id"),
        }),
        201,
      ),
  );
  return app;
}

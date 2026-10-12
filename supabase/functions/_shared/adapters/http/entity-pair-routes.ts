import { Hono } from "hono";
import { entityPairDelete, entityPairQuery, entityPairWrite } from "../../contracts/entity-pairs.ts";
import { entityReferenceId } from "../../contracts/entity-identity.ts";
import { changeEntityPair, type EntityPairDeps, listEntityLinks } from "../../core/entity-pairs/application.ts";
import { parse } from "../errors.ts";
import { type HttpEnv, json } from "./input.ts";
export function entityPairRoutes(d: EntityPairDeps) {
  const app = new Hono<HttpEnv>();
  app.get(
    "/entities/:id/links",
    async (c) =>
      c.json(
        await listEntityLinks(
          d,
          c.get("actor"),
          parse(entityReferenceId, c.req.param("id")),
          parse(entityPairQuery, c.req.query()),
        ),
      ),
  );
  app.post(
    "/entities/:id/links",
    async (c) =>
      c.json(
        await changeEntityPair(
          d,
          c.get("actor"),
          parse(entityReferenceId, c.req.param("id")),
          parse(entityPairWrite, await json(c.req.raw)),
          true,
        ),
      ),
  );
  app.post(
    "/entities/:id/links/:other_id/delete",
    async (c) =>
      c.json(
        await changeEntityPair(d, c.get("actor"), parse(entityReferenceId, c.req.param("id")), {
          ...parse(entityPairDelete, await json(c.req.raw)),
          other_id: parse(entityReferenceId, c.req.param("other_id")),
        }, false),
      ),
  );
  return app;
}

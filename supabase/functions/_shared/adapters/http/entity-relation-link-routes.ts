import { Hono } from "hono";
import { type HttpEnv, json } from "./input.ts";
import {
  connectEntityRelation,
  type EntityRelationLinkDeps,
  listEntityRelationLinks,
  replaceEntityRelation,
  unlinkEntityRelation,
} from "../../core/entity-relations/links.ts";
export function entityRelationLinkRoutes(d: EntityRelationLinkDeps) {
  const app = new Hono<HttpEnv>();
  const base = "/entity-relations/:definition_id/:side/:origin_id";
  app.get(
    `${base}/links`,
    async (c) =>
      c.json(
        await listEntityRelationLinks(d, c.get("actor"), {
          ...c.req.query(),
          definition_id: c.req.param("definition_id"),
          side: Number(c.req.param("side")),
          origin_id: c.req.param("origin_id"),
        }),
      ),
  );
  app.get(
    `${base}/candidates`,
    async (c) =>
      c.json(
        await listEntityRelationLinks(d, c.get("actor"), {
          ...c.req.query(),
          definition_id: c.req.param("definition_id"),
          side: Number(c.req.param("side")),
          origin_id: c.req.param("origin_id"),
        }, true),
      ),
  );
  for (
    const [action, run] of [["connect", connectEntityRelation], ["unlink", unlinkEntityRelation], [
      "replace",
      replaceEntityRelation,
    ]] as const
  ) {
    app.post(`${base}/${action}`, async (c) =>
      c.json(
        await run(d, c.get("actor"), {
          ...await json(c.req.raw) as object,
          definition_id: c.req.param("definition_id"),
          side: Number(c.req.param("side")),
          origin_id: c.req.param("origin_id"),
        }),
      ));
  }
  return app;
}

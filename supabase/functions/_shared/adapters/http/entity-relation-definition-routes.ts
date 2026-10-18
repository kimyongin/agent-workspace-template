import { Hono } from "hono";
import { type HttpEnv, json } from "./input.ts";
import {
  createEntityRelationDefinition,
  deleteEntityRelationDefinition,
  type EntityRelationDefinitionDeps,
  getEntityRelationDefinition,
  listEntityRelationDefinitions,
  updateEntityRelationDefinition,
} from "../../core/entity-relations/application.ts";
export function entityRelationDefinitionRoutes(d: EntityRelationDefinitionDeps) {
  const app = new Hono<HttpEnv>();
  app.get(
    "/entity-relation-definitions",
    async (c) => c.json(await listEntityRelationDefinitions(d, c.get("actor"), c.req.query())),
  );
  app.get(
    "/entity-relation-definitions/:id",
    async (c) =>
      c.json(await getEntityRelationDefinition(d, c.get("actor"), c.req.param("id"), c.req.query("purpose"))),
  );
  app.post(
    "/entity-relation-definitions",
    async (c) => c.json(await createEntityRelationDefinition(d, c.get("actor"), await json(c.req.raw)), 201),
  );
  app.patch(
    "/entity-relation-definitions/:id",
    async (c) =>
      c.json(await updateEntityRelationDefinition(d, c.get("actor"), c.req.param("id"), await json(c.req.raw))),
  );
  app.delete(
    "/entity-relation-definitions/:id",
    async (c) =>
      c.json(await deleteEntityRelationDefinition(d, c.get("actor"), c.req.param("id"), await json(c.req.raw))),
  );
  return app;
}

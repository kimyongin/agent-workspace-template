import { Hono } from "hono";
import { entityHttpQuery } from "../../contracts/entity-query.ts";
export { entityHttpQuery } from "../../contracts/entity-query.ts";
import { entityCreate, entityListQuery, entityLookup, entityRestore, entityUpdate } from "../../contracts/entity.ts";
import { businessMeta } from "../../contracts/change.ts";
import { expectedVersion } from "../../contracts/common.ts";
import { z } from "zod";
import * as entity from "../../core/entity/application.ts";
import { parse } from "../errors.ts";
import { type HttpEnv, json } from "./input.ts";
import { entityReferenceId } from "../../contracts/entity-identity.ts";
import { notFound } from "../../core/shared/errors.ts";
function idParam(value: string) {
  const parsed = entityReferenceId.safeParse(value);
  if (!parsed.success) throw notFound();
  return parsed.data;
}
export function entityRoutes(d: entity.EntityDeps) {
  const app = new Hono<HttpEnv>();
  app.post("/entities/:id/delete", async (c) => {
    const i = parse(z.strictObject({ expected_version: expectedVersion, ...businessMeta }), await json(c.req.raw));
    await entity.deleteEntity(
      d,
      c.get("actor"),
      idParam(c.req.param("id")),
      i.expected_version,
      i.change_note,
      i.change_tag_ids,
    );
    return c.body(null, 204);
  });
  app.get(
    "/entities",
    async (c) =>
      c.json(await entity.listEntities(d, c.get("actor"), parse(entityListQuery, entityHttpQuery(c.req.query())))),
  );
  app.post(
    "/entities/query",
    async (c) => c.json(await entity.listEntities(d, c.get("actor"), parse(entityListQuery, await json(c.req.raw)))),
  );
  app.get("/entities/lookup", async (c) => {
    const input = parse(entityLookup, c.req.query());
    return c.json(await entity.lookupEntity(d, c.get("actor"), input.entity_type_id, input.identifier));
  });
  app.post(
    "/entities/:id/restore",
    async (c) =>
      c.json(
        await entity.restoreEntity(
          d,
          c.get("actor"),
          idParam(c.req.param("id")),
          parse(entityRestore, await json(c.req.raw)),
        ),
      ),
  );
  app.get("/entities/:id", async (c) => c.json(await entity.getEntity(d, c.get("actor"), idParam(c.req.param("id")))));
  app.post(
    "/entities",
    async (c) => c.json(await entity.createEntity(d, c.get("actor"), parse(entityCreate, await json(c.req.raw))), 201),
  );
  app.patch(
    "/entities/:id",
    async (c) => {
      const input = await json(c.req.raw);
      entity.assertImmutableType(input);
      return c.json(
        await entity.updateEntity(
          d,
          c.get("actor"),
          idParam(c.req.param("id")),
          parse(entityUpdate, input),
        ),
      );
    },
  );
  return app;
}

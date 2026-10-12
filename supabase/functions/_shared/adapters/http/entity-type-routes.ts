import { Hono } from "hono";
import {
  createEntityType,
  type EntityTypeDeps,
  getEntitySchema,
  getEntityType,
  listEntitySchemaVersions,
  listEntityTypes,
  updateEntityType,
} from "../../core/entity-types/application.ts";
import { entityTypeIcons } from "../../contracts/entity-type.ts";
import { type HttpEnv, json } from "./input.ts";
import { invalidInput } from "../../core/shared/errors.ts";
function number(value: string | undefined) {
  return value === undefined ? undefined : Number(value);
}
export function entityTypeRoutes(deps: EntityTypeDeps) {
  const app = new Hono<HttpEnv>();
  app.get("/entity-type-icons", (c) => c.json({ items: entityTypeIcons }));
  app.get("/entity-types", (c) => {
    const archived = c.req.query("include_archived");
    if (archived !== undefined && !["true", "false"].includes(archived)) {
      throw invalidInput("include_archived는 true/false입니다");
    }
    return listEntityTypes(deps, c.get("actor"), {
      include_archived: archived === "true",
      limit: number(c.req.query("limit")),
      cursor: c.req.query("cursor"),
    }).then((value) => c.json(value));
  });
  app.post(
    "/entity-types",
    async (c) => c.json(await createEntityType(deps, c.get("actor"), await json(c.req.raw)), 201),
  );
  app.get(
    "/entity-types/:type_id",
    async (c) => c.json(await getEntityType(deps, c.get("actor"), c.req.param("type_id"))),
  );
  app.patch(
    "/entity-types/:type_id",
    async (c) => c.json(await updateEntityType(deps, c.get("actor"), c.req.param("type_id"), await json(c.req.raw))),
  );
  app.get(
    "/entity-types/:type_id/schema",
    async (c) =>
      c.json(
        await getEntitySchema(deps, c.get("actor"), {
          type_id: c.req.param("type_id"),
          schema_version: number(c.req.query("schema_version")),
        }),
      ),
  );
  app.get(
    "/entity-types/:type_id/schemas",
    async (c) =>
      c.json(
        await listEntitySchemaVersions(deps, c.get("actor"), {
          type_id: c.req.param("type_id"),
          limit: number(c.req.query("limit")),
          before: number(c.req.query("before")),
        }),
      ),
  );
  return app;
}

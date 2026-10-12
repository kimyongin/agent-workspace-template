import {
  analyzeEntitySchemaChange,
  applyEntitySchemaChange,
  createEntitySchemaChange,
  getEntitySchemaAnalysisRows,
  getEntitySchemaChange,
  listEntitySchemaChanges,
  updateEntitySchemaChange,
} from "../../core/entity-types/schema-changes.ts";
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
  app.post(
    "/entity-types/:type_id/schema-changes",
    async (c) =>
      c.json(await createEntitySchemaChange(deps, c.get("actor"), c.req.param("type_id"), await json(c.req.raw)), 201),
  );
  app.get(
    "/entity-types/:type_id/schema-changes",
    async (c) =>
      c.json(
        await listEntitySchemaChanges(deps, c.get("actor"), c.req.param("type_id"), {
          limit: number(c.req.query("limit")),
          before: c.req.query("before"),
        }),
      ),
  );
  app.get(
    "/entity-types/:type_id/schema-changes/:change_id",
    async (c) =>
      c.json(await getEntitySchemaChange(deps, c.get("actor"), c.req.param("type_id"), c.req.param("change_id"))),
  );
  app.patch(
    "/entity-types/:type_id/schema-changes/:change_id",
    async (c) =>
      c.json(
        await updateEntitySchemaChange(
          deps,
          c.get("actor"),
          c.req.param("type_id"),
          c.req.param("change_id"),
          await json(c.req.raw),
        ),
      ),
  );
  app.post(
    "/entity-types/:type_id/schema-changes/:change_id/analyze",
    async (c) =>
      c.json(
        await analyzeEntitySchemaChange(
          deps,
          c.get("actor"),
          c.req.param("type_id"),
          c.req.param("change_id"),
          await json(c.req.raw),
        ),
        202,
      ),
  );
  app.post(
    "/entity-types/:type_id/schema-changes/:change_id/apply",
    async (c) =>
      c.json(
        await applyEntitySchemaChange(
          deps,
          c.get("actor"),
          c.req.param("type_id"),
          c.req.param("change_id"),
          await json(c.req.raw),
        ),
      ),
  );
  app.get("/entity-types/:type_id/schema-changes/:change_id/rows", async (c) => {
    const failures = c.req.query("failures_only");
    if (failures !== undefined && !["true", "false"].includes(failures)) {
      throw invalidInput("failures_only는 true/false입니다");
    }
    return c.json(
      await getEntitySchemaAnalysisRows(deps, c.get("actor"), c.req.param("type_id"), c.req.param("change_id"), {
        analysis_id: c.req.query("analysis_id"),
        limit: number(c.req.query("limit")),
        after: c.req.query("after"),
        failures_only: failures === "true",
      }),
    );
  });
  return app;
}

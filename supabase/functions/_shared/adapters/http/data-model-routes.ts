import { Hono } from "hono";
import type { HttpEnv } from "./input.ts";
import { json } from "./input.ts";
import {
  applyDataModel,
  type DataModelDeps,
  exportDataModel,
  getDataModelChange,
  listDataModelChanges,
  prepareDataModel,
  previewDataModel,
} from "../../core/data-model/application.ts";
import { analyzeDataModel, changeDataModelGroup } from "../../core/data-model/groups.ts";
export function dataModelRoutes(d: DataModelDeps) {
  const app = new Hono<HttpEnv>();
  app.get("/data-model/export", async (c) => c.json(await exportDataModel(d, c.get("actor"))));
  app.post(
    "/data-model/preview",
    async (c) => c.json(await previewDataModel(d, c.get("actor"), await json(c.req.raw))),
  );
  app.get("/data-model/changes", async (c) => c.json(await listDataModelChanges(d, c.get("actor"), c.req.query())));
  app.post(
    "/data-model/changes",
    async (c) => c.json(await prepareDataModel(d, c.get("actor"), await json(c.req.raw)), 201),
  );
  app.get(
    "/data-model/changes/:id",
    async (c) => c.json(await getDataModelChange(d, c.get("actor"), c.req.param("id"))),
  );
  app.post(
    "/data-model/changes/:id/apply",
    async (c) => c.json(await applyDataModel(d, c.get("actor"), c.req.param("id"), await json(c.req.raw))),
  );
  app.post(
    "/data-model/changes/:id/analyze",
    async (c) => c.json(await analyzeDataModel(d, c.get("actor"), c.req.param("id"), await json(c.req.raw))),
  );
  for (const action of ["cancel", "retry"] as const) {
    app.post(
      `/data-model/changes/:id/${action}`,
      async (c) =>
        c.json(await changeDataModelGroup(d, c.get("actor"), c.req.param("id"), await json(c.req.raw), action)),
    );
  }
  return app;
}

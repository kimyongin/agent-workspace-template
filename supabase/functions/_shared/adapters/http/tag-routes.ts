import { Hono } from "hono";
import { tagCreate, tagListQuery, tagRename } from "../../contracts/tag.ts";
import * as tags from "../../core/tags/application.ts";
import { parse } from "../errors.ts";
import { type HttpEnv, idParam, json, versionQuery } from "./input.ts";
export function tagRoutes(d: tags.TagDeps) {
  const app = new Hono<HttpEnv>();
  app.get("/tags", async (c) => c.json(await tags.listTags(d, c.get("actor"), parse(tagListQuery, c.req.query()))));
  app.post(
    "/tags",
    async (c) => c.json(await tags.createTag(d, c.get("actor"), parse(tagCreate, await json(c.req.raw))), 201),
  );
  app.patch(
    "/tags/:id",
    async (c) =>
      c.json(
        await tags.renameTag(d, c.get("actor"), idParam(c.req.param("id")), parse(tagRename, await json(c.req.raw))),
      ),
  );
  app.delete("/tags/:id", async (c) => {
    await tags.deleteTag(
      d,
      c.get("actor"),
      idParam(c.req.param("id")),
      parse(versionQuery, c.req.query()).expected_version,
    );
    return c.body(null, 204);
  });
  return app;
}

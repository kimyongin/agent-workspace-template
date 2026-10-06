// 웹용 HTTP: 할 일·기록 경로. 입력을 contracts로 검사하고 유스케이스를 호출한다. 업무 판단은 하지 않는다.
import { Hono } from "hono";
import { z } from "zod";
import { businessMeta } from "../../contracts/change.ts";
import { expectedVersion, isoDate } from "../../contracts/common.ts";
import { recordCreate, recordListQuery, recordUpdate } from "../../contracts/record.ts";
import { occurrenceRange, taskComplete, taskCreate, taskListQuery, taskUpdate } from "../../contracts/task.ts";
import * as activity from "../../core/activity/application.ts";
import { type HttpEnv, idParam, json, versionQuery } from "./input.ts";
import { parse } from "../errors.ts";

const versionBody = z.strictObject({ expected_version: expectedVersion, ...businessMeta });

export function activityRoutes(deps: activity.ActivityDeps) {
  const app = new Hono<HttpEnv>();
  app.post("/tasks/:id/delete", async (c) => {
    const i = parse(versionBody, await json(c.req.raw));
    await activity.deleteTask(
      deps,
      c.get("actor"),
      idParam(c.req.param("id")),
      i.expected_version,
      i.change_note,
    );
    return c.body(null, 204);
  });

  app.post("/tasks", async (c) => {
    const input = parse(taskCreate, await json(c.req.raw));
    return c.json(await activity.createTask(deps, c.get("actor"), input), 201);
  });
  app.get("/tasks", async (c) => {
    const raw = c.req.query();
    const query = parse(taskListQuery, {
      ...raw,
      ...(raw.tag_ids !== undefined ? { tag_ids: raw.tag_ids.split(",") } : {}),
    });
    return c.json(await activity.listTasks(deps, c.get("actor"), query));
  });
  app.get("/tasks/:id", async (c) => {
    return c.json(await activity.getTask(deps, c.get("actor"), idParam(c.req.param("id"))));
  });
  app.patch("/tasks/:id", async (c) => {
    const id = idParam(c.req.param("id"));
    const patch = parse(taskUpdate, await json(c.req.raw));
    return c.json(await activity.updateTask(deps, c.get("actor"), id, patch));
  });
  app.delete("/tasks/:id", async (c) => {
    const id = idParam(c.req.param("id"));
    const i = parse(versionQuery, c.req.query());
    await activity.deleteTask(deps, c.get("actor"), id, i.expected_version, i.change_note);
    return c.body(null, 204);
  });
  app.post("/tasks/:id/complete", async (c) => {
    const id = idParam(c.req.param("id"));
    const input = parse(taskComplete, await json(c.req.raw));
    return c.json(await activity.completeTask(deps, c.get("actor"), id, input));
  });
  app.post("/tasks/:id/stop", async (c) => {
    const id = idParam(c.req.param("id"));
    const i = parse(versionBody, await json(c.req.raw));
    return c.json(
      await activity.stopTask(deps, c.get("actor"), id, i.expected_version, i.change_note),
    );
  });
  app.post("/tasks/:id/resume", async (c) => {
    const id = idParam(c.req.param("id"));
    const i = parse(versionBody, await json(c.req.raw));
    return c.json(
      await activity.resumeTask(
        deps,
        c.get("actor"),
        id,
        i.expected_version,
        i.change_note,
      ),
    );
  });
  app.get("/tasks/:id/occurrences", async (c) => {
    const id = idParam(c.req.param("id"));
    const range = parse(occurrenceRange, c.req.query());
    return c.json(await activity.listOccurrences(deps, c.get("actor"), id, range));
  });
  app.post("/tasks/:id/occurrences/:date/records", async (c) => {
    const id = idParam(c.req.param("id"));
    const date = parse(z.object({ date: isoDate }), { date: c.req.param("date") }).date;
    const input = parse(recordCreate, await json(c.req.raw));
    return c.json(await activity.recordOccurrence(deps, c.get("actor"), id, date, input), 201);
  });

  app.post("/records", async (c) => {
    const input = parse(recordCreate, await json(c.req.raw));
    return c.json(await activity.createRecord(deps, c.get("actor"), input), 201);
  });
  app.get("/records", async (c) => {
    const raw = c.req.query();
    const query = parse(recordListQuery, {
      ...raw,
      ...(raw.tag_ids !== undefined ? { tag_ids: raw.tag_ids.split(",") } : {}),
    });
    return c.json(await activity.listRecords(deps, c.get("actor"), query));
  });
  app.get("/records/:id", async (c) => {
    return c.json(await activity.getRecord(deps, c.get("actor"), idParam(c.req.param("id"))));
  });
  app.patch("/records/:id", async (c) => {
    const id = idParam(c.req.param("id"));
    const patch = parse(recordUpdate, await json(c.req.raw));
    return c.json(await activity.updateRecord(deps, c.get("actor"), id, patch));
  });
  app.delete("/records/:id", async (c) => {
    const id = idParam(c.req.param("id"));
    const i = parse(versionQuery, c.req.query());
    await activity.deleteRecord(deps, c.get("actor"), id, i.expected_version, i.change_note);
    return c.body(null, 204);
  });

  return app;
}

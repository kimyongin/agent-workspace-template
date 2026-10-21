import { businessRequest, businessWorkspaceFixture } from "./_workspace-business.ts";
import * as tags from "../../functions/_shared/core/tags/application.ts";
import { SqlTagUnitOfWork } from "../../functions/_shared/adapters/supabase/tag-store.ts";
import { assertEquals, assertRejects } from "@std/assert";
import { entityCreate, entityUpdate } from "../../functions/_shared/contracts/entity.ts";
import { taskCreate } from "../../functions/_shared/contracts/task.ts";
import { activityRoutes } from "../../functions/_shared/adapters/http/activity-routes.ts";
import { activityTools } from "../../functions/_shared/adapters/mcp/activity-tools.ts";
import { Hono } from "hono";
import type { HttpEnv } from "../../functions/_shared/adapters/http/input.ts";
import { recordListQuery } from "../../functions/_shared/contracts/record.ts";
import * as entity from "../../functions/_shared/core/entity/application.ts";
import * as activity from "../../functions/_shared/core/activity/application.ts";
import { SqlEntityUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-store.ts";
import { SqlUnitOfWork } from "../../functions/_shared/adapters/supabase/activity-store.ts";
import { connect, dbTest, urls } from "./_db.ts";
const admin = connect(urls.admin, { max: 1 }), sql = connect(urls.direct, { max: 3, prepare: false });
const ed = { uow: new SqlEntityUnitOfWork(sql) },
  ad = { uow: new SqlUnitOfWork(sql), clock: { now: () => new Date() } };
dbTest(
  "change record tags are separate, workspace-scoped, atomic and carried through HTTP/MCP transitions",
  async () => {
    const workspace = await businessWorkspaceFixture(admin, sql);
    try {
      const kind = await workspace.createKind("검사 자료");
      await workspace.grant(workspace.member, [
        { target_kind: "tasks", target_id: "*", access: "write" },
        { target_kind: "entity_type", target_id: kind.id, access: "write" },
      ]);
      const f = { ...workspace, actor: workspace.member };
      const otherWorkspace = await workspace.addWorkspace("다른 업무 공간");
      await workspace.grant(otherWorkspace.member, [{ target_kind: "tasks", target_id: "*", access: "write" }]);
      const other = { actor: otherWorkspace.member };
      const schema = { entity_type_id: kind.id, schema_version: 1 };
      const tagDeps = { uow: new SqlTagUnitOfWork(sql) };
      const own = (await tags.createTag(tagDeps, businessRequest(f.actor), { scope: "record", name: "기록" })).id;
      const entityTag = (await tags.createTag(tagDeps, businessRequest(f.actor), { scope: "entity", name: "원본" })).id;
      const foreign =
        (await tags.createTag(tagDeps, businessRequest(other.actor), { scope: "record", name: "다른 공간" })).id;
      const events = () =>
        activity.listRecords(ad, f.actor, recordListQuery.parse({ record_kind: "change", limit: 100 }));
      const target = await entity.createEntity(
        ed,
        businessRequest(f.actor),
        entityCreate.parse({
          ...schema,
          properties: { prop_1: "원본" },
          change_tag_ids: [own],
        }),
      );
      const classified = await tags.setTagConnections(tagDeps, businessRequest(f.actor), {
        target_kind: "entity",
        target_id: target.id,
        expected_version: target.version,
        tag_ids: [entityTag],
      });
      assertEquals(classified.tag_ids, [entityTag]);
      assertEquals(
        (await events()).items.find((row) => row.change?.target_id === target.id && row.change.action === "create")!
          .tag_ids,
        [own],
      );
      const beforeInvalid = await events();
      for (const invalid of [foreign, entityTag]) {
        await assertRejects(() =>
          entity.updateEntity(
            ed,
            businessRequest(f.actor),
            target.id,
            entityUpdate.parse({
              schema_version: schema.schema_version,
              expected_version: classified.version,
              properties: { prop_1: "권한 없는 변경" },
              change_tag_ids: [invalid],
            }),
          )
        );
        assertEquals((await entity.getEntity(ed, f.actor, target.id)).properties.prop_1, "원본");
        assertEquals(await events(), beforeInvalid);
      }
      const recurring = await activity.createTask(
        ad,
        businessRequest(f.actor),
        taskCreate.parse({
          kind: "recurring",
          title: "반복",
          recurrence: { freq: "daily", starts_on: "2020-01-01" },
          timezone: "UTC",
          change_tag_ids: [own],
        }),
      );
      const app = new Hono<HttpEnv>();
      app.use("*", async (c, next) => {
        c.set("actor", { ...f.actor, request: { key: c.req.header("Idempotency-Key") ?? "" } });
        await next();
      });
      app.route("/", activityRoutes(ad));
      const stopped = await app.request(`/tasks/${recurring.id}/stop`, {
        method: "POST",
        headers: { "content-type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ expected_version: recurring.version, change_note: "중단 메모", change_tag_ids: [own] }),
      });
      assertEquals(stopped.status, 200);
      const current = await stopped.json();
      await activityTools(ad).find((t) => t.name === "resume_task")!.handler({
        request_key: crypto.randomUUID(),
        id: recurring.id,
        expected_version: current.version,
        change_note: "재개 메모",
        change_tag_ids: [own],
      }, f.actor);
      for (const memo of ["중단 메모", "재개 메모"]) {
        assertEquals((await events()).items.find((r) => r.body === memo)!.tag_ids, [own]);
      }
      await entity.deleteEntity(ed, businessRequest(f.actor), target.id, classified.version, "원본 삭제", [own]);
      assertEquals((await events()).items.find((r) => r.body === "원본 삭제")!.tag_ids, [own]);
      const resultTask = await activity.createTask(
        ad,
        businessRequest(f.actor),
        taskCreate.parse({ kind: "once", title: "직접 수행" }),
      );
      const before = (await events()).items.length;
      const completed = await activity.completeTask(ad, businessRequest(f.actor), resultTask.id, {
        expected_version: resultTask.version,
        body: "직접 작성",
      });
      await tags.setTagConnections(tagDeps, businessRequest(f.actor), {
        target_kind: "record",
        target_id: completed.record.id,
        expected_version: completed.record.version,
        tag_ids: [own],
      });
      assertEquals((await events()).items.length, before);
    } finally {
      await workspace.cleanup();
    }
  },
);
dbTest("business save preserves exact entered memo, factual blank default, no-op, retry and rollback", async () => {
  const workspace = await businessWorkspaceFixture(admin, sql);
  try {
    const kind = await workspace.createKind("검사 자료");
    await workspace.grant(workspace.member, [
      { target_kind: "tasks", target_id: "*", access: "write" },
      { target_kind: "entity_type", target_id: kind.id, access: "write" },
    ]);
    const f = { ...workspace, actor: workspace.member };
    const otherWorkspace = await workspace.addWorkspace("다른 업무 공간");
    await workspace.grant(otherWorkspace.member, [{ target_kind: "tasks", target_id: "*", access: "write" }]);
    const other = { actor: otherWorkspace.member };
    const schema = { entity_type_id: kind.id, schema_version: 1 };
    const e = await entity.createEntity(
      ed,
      businessRequest(f.actor),
      entityCreate.parse({
        ...schema,
        properties: { prop_1: "대상" },
        change_note: "",
      }),
    );
    const records = () =>
      activity.listRecords(ad, f.actor, recordListQuery.parse({ record_kind: "change", limit: 100 }));
    assertEquals((await records()).items.find((r) => r.change?.target_id === e.id)!.body, "대상 등록");
    const task = await activity.createTask(
      ad,
      businessRequest(f.actor),
      taskCreate.parse({ kind: "once", title: "업무", change_note: "  업무 근거\n" }),
    );
    assertEquals((await records()).items.find((r) => r.change?.target_id === task.id)!.body, "  업무 근거\n");
    const memo = "  상세 근거\n" + "가".repeat(21000);
    const patch = entityUpdate.parse({
      schema_version: schema.schema_version,
      expected_version: e.version,
      properties: { prop_1: "새 대상" },
      change_note: memo,
    });
    const saved = await entity.updateEntity(ed, businessRequest(f.actor), e.id, patch);
    await assertRejects(() => entity.updateEntity(ed, businessRequest(f.actor), e.id, patch));
    await assertRejects(() =>
      entity.updateEntity(ed, businessRequest(other.actor), e.id, { ...patch, expected_version: saved.version })
    );
    const events = await records(), change = events.items.find((r) => r.change?.action === "update")!;
    assertEquals(change.body, memo);
    assertEquals([change.change!.before, change.change!.after], [null, null]);
    assertEquals(["title", "summary", "change_note"].some((key) => key in change), false);
    await entity.updateEntity(
      ed,
      businessRequest(f.actor),
      e.id,
      entityUpdate.parse({
        schema_version: schema.schema_version,
        expected_version: saved.version,
        properties: { prop_1: "새 대상" },
        change_note: "다른 메모",
      }),
    );
    assertEquals(await records(), events);
    const failing: entity.EntityDeps = {
      uow: {
        run: (actor, fn, entry) =>
          ed.uow.run(actor, (s) =>
            fn(
              new Proxy(s, {
                get: (target, key) =>
                  key === "appendChange" ? () => Promise.reject(Error("failed record")) : Reflect.get(target, key),
              }),
            ), entry),
      },
    };
    await assertRejects(() =>
      entity.updateEntity(
        failing,
        businessRequest(f.actor),
        e.id,
        entityUpdate.parse({
          schema_version: schema.schema_version,
          expected_version: saved.version,
          properties: { prop_1: "최종 대상" },
        }),
      )
    );
    assertEquals((await entity.getEntity(ed, f.actor, e.id)).properties.prop_1, "새 대상");
    assertEquals(await records(), events);
    const updated = await entity.updateEntity(
      ed,
      businessRequest(f.actor),
      e.id,
      entityUpdate.parse({
        schema_version: schema.schema_version,
        expected_version: saved.version,
        properties: { prop_1: "최종 대상" },
        change_note: "   ",
      }),
    );
    assertEquals((await records()).items.find((r) => r.body === "최종 대상 수정 (이름)")!.change!.target_id, e.id);
    await entity.deleteEntity(ed, businessRequest(f.actor), e.id, updated.version, "삭제 근거");
    assertEquals((await records()).items.find((r) => r.change?.action === "delete")!.body, "삭제 근거");
  } finally {
    await workspace.cleanup();
  }
});

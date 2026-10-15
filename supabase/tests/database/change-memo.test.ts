import { requestActor } from "../_request.ts";
import { assertEquals, assertRejects } from "@std/assert";
import { entityCreate, entityUpdate } from "../../functions/_shared/contracts/entity.ts";
import { taskCreate } from "../../functions/_shared/contracts/task.ts";
import { recordCreate } from "../../functions/_shared/contracts/record.ts";
import { activityRoutes } from "../../functions/_shared/adapters/http/activity-routes.ts";
import { activityTools } from "../../functions/_shared/adapters/mcp/activity-tools.ts";
import { Hono } from "hono";
import type { HttpEnv } from "../../functions/_shared/adapters/http/input.ts";
import { recordListQuery } from "../../functions/_shared/contracts/record.ts";
import * as entity from "../../functions/_shared/core/entity/application.ts";
import * as activity from "../../functions/_shared/core/activity/application.ts";
import { SqlEntityUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-store.ts";
import { SqlUnitOfWork } from "../../functions/_shared/adapters/supabase/activity-store.ts";
import { connect, dbTest, fixtureOwner, urls } from "./_db.ts";
import { entityFixture } from "./_entity.ts";
const admin = connect(urls.admin, { max: 1 }), sql = connect(urls.direct, { max: 3, prepare: false });
const ed = { uow: new SqlEntityUnitOfWork(sql) },
  ad = { uow: new SqlUnitOfWork(sql), clock: { now: () => new Date() } };
dbTest("change record tags are separate, owner-scoped, atomic and carried through HTTP/MCP transitions", async () => {
  const f = await fixtureOwner(admin), other = await fixtureOwner(admin);
  try {
    const schema = await entityFixture(admin, f.actor.userId);
    const tags = await admin`insert into app.tags(owner_id,name,scope) values
      (${f.actor.userId},'원본','entity'),(${f.actor.userId},'기록','record'),(${other.actor.userId},'다른 사용자','record') returning id,owner_id,scope`;
    const own = tags.find((t) => t.scope === "record" && t.owner_id === f.actor.userId)!.id as string;
    const entityTag = tags.find((t) => t.scope === "entity")!.id as string;
    const foreign = tags.find((t) => t.owner_id === other.actor.userId)!.id as string;
    const events = () =>
      activity.listRecords(ad, f.actor, recordListQuery.parse({ record_kind: "change", limit: 100 }));
    const target = await entity.createEntity(
      ed,
      requestActor(f.actor),
      entityCreate.parse({
        ...schema,
        source: "app",
        external_id: crypto.randomUUID(),
        properties: { prop_1: "원본" },
        tag_ids: [entityTag],
        change_tag_ids: [own],
      }),
    );
    assertEquals(target.tag_ids, [entityTag]);
    assertEquals((await events()).items[0].tag_ids, [own]);
    for (const invalid of [foreign, entityTag]) {
      await assertRejects(() =>
        entity.updateEntity(
          ed,
          requestActor(f.actor),
          target.id,
          entityUpdate.parse({
            schema_version: schema.schema_version,
            expected_version: target.version,
            properties: { prop_2: 99 },
            change_tag_ids: [invalid],
          }),
        )
      );
      assertEquals((await entity.getEntity(ed, f.actor, target.id)).properties.prop_2, null);
      assertEquals((await events()).items.length, 1);
    }
    const recurring = await activity.createTask(
      ad,
      requestActor(f.actor),
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
    await entity.deleteEntity(ed, requestActor(f.actor), target.id, target.version, "원본 삭제", [own]);
    assertEquals((await events()).items.find((r) => r.body === "원본 삭제")!.tag_ids, [own]);
    const before = (await events()).items.length;
    await activity.createRecord(
      ad,
      requestActor(f.actor),
      recordCreate.parse({ body: "직접 작성", tag_ids: [own] }),
    );
    assertEquals((await events()).items.length, before);
  } finally {
    await f.cleanup();
    await other.cleanup();
  }
});
dbTest("business save preserves exact entered memo, factual blank default, no-op, retry and rollback", async () => {
  const f = await fixtureOwner(admin), other = await fixtureOwner(admin);
  try {
    const schema = await entityFixture(admin, f.actor.userId);
    const e = await entity.createEntity(
      ed,
      requestActor(f.actor),
      entityCreate.parse({
        ...schema,
        source: "app",
        external_id: crypto.randomUUID(),
        properties: { prop_1: "대상", prop_2: 10 },
        change_note: "",
      }),
    );
    const records = () =>
      activity.listRecords(ad, f.actor, recordListQuery.parse({ record_kind: "change", limit: 100 }));
    assertEquals((await records()).items.find((r) => r.change?.target_id === e.id)!.body, "대상 등록");
    const task = await activity.createTask(
      ad,
      requestActor(f.actor),
      taskCreate.parse({ kind: "once", title: "업무", change_note: "  업무 근거\n" }),
    );
    assertEquals((await records()).items.find((r) => r.change?.target_id === task.id)!.body, "  업무 근거\n");
    const memo = "  상세 근거\n" + "가".repeat(21000);
    const patch = entityUpdate.parse({
      schema_version: schema.schema_version,
      expected_version: e.version,
      properties: { prop_2: 20 },
      change_note: memo,
    });
    const saved = await entity.updateEntity(ed, requestActor(f.actor), e.id, patch);
    await assertRejects(() => entity.updateEntity(ed, requestActor(f.actor), e.id, patch));
    await assertRejects(() =>
      entity.updateEntity(ed, requestActor(other.actor), e.id, { ...patch, expected_version: saved.version })
    );
    const events = await records(), change = events.items.find((r) => r.change?.action === "update")!;
    assertEquals(change.body, memo);
    assertEquals([change.change!.before, change.change!.after], [null, null]);
    assertEquals(["title", "summary", "change_note"].some((key) => key in change), false);
    await entity.updateEntity(
      ed,
      requestActor(f.actor),
      e.id,
      entityUpdate.parse({
        schema_version: schema.schema_version,
        expected_version: saved.version,
        properties: { prop_2: 20 },
        change_note: "다른 메모",
      }),
    );
    assertEquals(await records(), events);
    const failing: entity.EntityDeps = {
      uow: {
        run: (actor, fn) =>
          ed.uow.run(actor, (s) =>
            fn(
              new Proxy(s, {
                get: (target, key) =>
                  key === "appendChange" ? () => Promise.reject(Error("failed record")) : Reflect.get(target, key),
              }),
            )),
      },
    };
    await assertRejects(() =>
      entity.updateEntity(
        failing,
        requestActor(f.actor),
        e.id,
        entityUpdate.parse({
          schema_version: schema.schema_version,
          expected_version: saved.version,
          properties: { prop_2: 30 },
        }),
      )
    );
    assertEquals((await entity.getEntity(ed, f.actor, e.id)).properties.prop_2, 20);
    assertEquals(await records(), events);
    const updated = await entity.updateEntity(
      ed,
      requestActor(f.actor),
      e.id,
      entityUpdate.parse({
        schema_version: schema.schema_version,
        expected_version: saved.version,
        properties: { prop_2: 30 },
        change_note: "   ",
      }),
    );
    assertEquals((await records()).items.find((r) => r.body === "대상 수정 (속성 2)")!.change!.target_id, e.id);
    await entity.deleteEntity(ed, requestActor(f.actor), e.id, updated.version, "삭제 근거");
    assertEquals((await records()).items.find((r) => r.change?.action === "delete")!.body, "삭제 근거");
  } finally {
    await f.cleanup();
    await other.cleanup();
  }
});

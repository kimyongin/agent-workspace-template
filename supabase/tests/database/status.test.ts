import { assertEquals, assertRejects } from "@std/assert";
import { Hono } from "hono";
import { statusRoutes } from "../../functions/_shared/adapters/http/status-routes.ts";
import { statusTools } from "../../functions/_shared/adapters/mcp/status-tools.ts";
import type { HttpEnv } from "../../functions/_shared/adapters/http/input.ts";
import { toErrorBody } from "../../functions/_shared/adapters/errors.ts";
import { SqlStatusReader } from "../../functions/_shared/adapters/supabase/status-reader.ts";
import type { StatusOverview } from "../../functions/_shared/contracts/status.ts";
import { SEARCH_PIPELINE } from "../../functions/_shared/core/search/config.ts";
import { asUser, connect, dbTest, fixtureOwner, outcome, urls } from "./_db.ts";

const admin = connect(urls.admin, { max: 1 }), user = connect(urls.pooler, { max: 2, prepare: false });
const at = "2026-10-10T15:00:00.000Z";
const id = () => `20261011-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
function client(owner: string) {
  const actor = { userId: owner }, deps = { reader: new SqlStatusReader(user), clock: { now: () => new Date(at) } };
  const app = new Hono<HttpEnv>();
  app.use("*", async (c, next) => {
    c.set("actor", actor);
    await next();
  });
  app.route("/", statusRoutes(deps));
  app.onError((e, c) => {
    const r = toErrorBody(e);
    return c.json(r.body, r.status as 400);
  });
  return {
    app,
    tool: statusTools(deps)[0],
    actor,
    status: async () => {
      const r = await app.request("/status");
      assertEquals(r.status, 200);
      return await r.json() as StatusOverview;
    },
  };
}

dbTest(
  "status HTTP/MCP: real owner RLS, Seoul midnight, 30 zero-filled dates, current counts and deletion",
  async () => {
    const own = await fixtureOwner(admin), foreign = await fixtureOwner(admin);
    try {
      const c = client(own.actor.userId);
      const empty = await c.status();
      assertEquals(empty.daily.length, 30);
      assertEquals(empty.period, { from: "2026-09-12", to: "2026-10-11", days: 30 });
      assertEquals(empty.daily[0], {
        date: "2026-09-12",
        entities_created: 0,
        tasks_created: 0,
        once_completed: 0,
        records_created: 0,
        indexing: { indexed: 0, preparing: 0, attention: 0, excluded: 0 },
      });
      await admin`insert into app.entities(owner_id,id,source,external_id,prop1,created_at,deleted_at) values
      (${own.actor.userId},'app:status-a','app','status-a','active',${at},null),
      (${own.actor.userId},'app:status-b','app','status-b','deleted','2026-10-10T14:59:59.999Z',${at}),
      (${foreign.actor.userId},'app:status-c','app','status-c','foreign',${at},null)`;
      const task = id(), oldTask = id(), recurring = id();
      await admin`insert into app.tasks(id,owner_id,kind,title,status,created_at,completed_at) values
      (${task},${own.actor.userId},'once','done','done',${at},${at}),
      (${oldTask},${own.actor.userId},'once','open','open','2026-09-11T14:59:59.999Z',null)`;
      await admin`insert into app.tasks(id,owner_id,kind,title,status,created_at,recurrence,timezone) values
      (${recurring},${own.actor.userId},'recurring','repeat','active',${at},'{"frequency":"daily","interval":1,"start_on":"2026-10-11"}'::jsonb,'Asia/Seoul')`;
      const record = id(), result = id(), change = id();
      await admin`insert into app.records(id,owner_id,body,record_kind,created_at,occurred_at) values
      (${record},${own.actor.userId},'known','user',${at},'2020-01-01T00:00:00Z'),
      (${result},${own.actor.userId},'result','result','2026-10-10T14:59:59.999Z',${at}),
      (${change},${own.actor.userId},'change','change','2026-09-11T14:59:59.999Z',${at}),
      (${id()},${foreign.actor.userId},'foreign private','user',${at},${at})`;
      const overview = await c.status();
      assertEquals(overview.entities, { total: 2, active: 1, deleted: 1 });
      assertEquals(overview.tasks, { total: 3, open: 1, done: 1, active: 1, stopped: 0 });
      assertEquals(overview.records, { total: 3, user: 1, result: 1, change: 1 });
      assertEquals(overview.daily[28], {
        date: "2026-10-10",
        entities_created: 1,
        tasks_created: 0,
        once_completed: 0,
        records_created: 1,
        indexing: { indexed: 0, preparing: 1, attention: 0, excluded: 0 },
      });
      assertEquals(overview.daily[29], {
        date: "2026-10-11",
        entities_created: 1,
        tasks_created: 2,
        once_completed: 1,
        records_created: 1,
        indexing: { indexed: 0, preparing: 1, attention: 0, excluded: 0 },
      });
      assertEquals(await c.tool.handler({}, c.actor), overview);
      const utc = await (await c.app.request("/status?timezone=UTC")).json();
      assertEquals(utc.period.to, "2026-10-10");
      await admin`delete from app.tasks where owner_id=${own.actor.userId} and id=${task}`;
      await admin`delete from app.records where owner_id=${own.actor.userId} and id=${record}`;
      const after = await c.status();
      assertEquals(after.tasks.total, 2);
      assertEquals(after.daily[29].tasks_created, 1);
      assertEquals(after.daily[29].once_completed, 0);
      assertEquals(after.daily[29].records_created, 0);
      assertEquals((await client(foreign.actor.userId).status()).records.total, 1);
      assertEquals((await client(crypto.randomUUID()).app.request("/status")).status, 401);
      const denied = await asUser(user, own.actor.userId, (tx) => outcome(tx`select * from private.passage_effects`));
      assertEquals(denied.startsWith("42501"), true);
    } finally {
      await own.cleanup();
      await foreign.cleanup();
    }
  },
);

dbTest(
  "status HTTP: exclusive current indexing uses source hash/pipeline/revision and expired leases without exposing effects",
  async () => {
    const own = await fixtureOwner(admin);
    try {
      const records: Record<string, string> = {};
      for (
        const name of [
          "indexed",
          "excluded",
          "missing",
          "stale_hash",
          "stale_pipeline",
          "stale_revision",
          "unknown",
          "expired",
          "running",
          "transient",
          "configuration",
          "held",
          "split_parent",
        ]
      ) {
        const record = id();
        records[name] = record;
        await admin`insert into app.records(id,owner_id,body,created_at,occurred_at) values(${record},${own.actor.userId},'known body',${at},${at})`;
        if (name === "missing") continue;
        await admin`insert into app.search_index_state(owner_id,kind,id,input_hash,pipeline,state,generation,reason) values
        (${own.actor.userId},'record',${record},case when ${name}='stale_hash' then repeat('a',64) else encode(extensions.digest('known body','sha256'),'hex') end,
        ${name === "stale_pipeline" ? "old-pipeline" : SEARCH_PIPELINE},${
          name === "indexed" ? "indexed" : name === "excluded" ? "excluded" : "pending"
        },1,${name === "held" ? "retry_exhausted" : null})`;
        if (name === "indexed") {
          const vector = JSON.stringify(Array.from({ length: 1024 }, (_, n) => n === 0 ? 1 : 0));
          await admin`insert into app.search_chunks(owner_id,record_id,generation,ordinal,start_offset,end_offset,embedding) values(${own.actor.userId},${record},1,0,0,10,${vector}::extensions.vector)`;
        }
        if (
          [
            "stale_hash",
            "stale_pipeline",
            "stale_revision",
            "unknown",
            "expired",
            "running",
            "transient",
            "configuration",
            "held",
            "split_parent",
          ].includes(name)
        ) {
          await admin`insert into private.passage_effects(owner_id,record_id,source_version,source_hash,pipeline,provider_scope,model,dimensions,start_offset,end_offset,input_hash,state,reason,attempts,lease_until)
          values(${own.actor.userId},${record},${
            name === "stale_revision" ? 2 : 1
          },encode(extensions.digest('known body','sha256'),'hex'),${SEARCH_PIPELINE},repeat('b',64),'private-model',1024,0,10,repeat('c',64),
            ${
            ["expired", "running"].includes(name)
              ? "running"
              : ["transient", "configuration", "split_parent"].includes(name)
              ? "failed"
              : "unknown"
          },
            ${
            name === "transient"
              ? "transient"
              : name === "split_parent"
              ? "input_limit"
              : name === "configuration"
              ? "configuration"
              : ["expired", "running"].includes(name)
              ? null
              : "provider_unknown"
          },${name === "held" ? 5 : 1},${
            name === "running" ? "2026-10-10T15:01:30Z" : "2026-10-10T14:59:59Z"
          }::timestamptz)`;
        }
      }
      // A cached input-limit parent is automatically split; a live child is preparation, not a problem.
      await admin`insert into private.passage_effects(owner_id,record_id,source_version,source_hash,pipeline,provider_scope,model,dimensions,start_offset,end_offset,input_hash,state,attempts,lease_until)
        values(${own.actor.userId},${records.split_parent},1,encode(extensions.digest('known body','sha256'),'hex'),${SEARCH_PIPELINE},repeat('b',64),'private-model',1024,0,5,repeat('d',64),'running',1,'2026-10-10T15:01:30Z')`;
      const c = client(own.actor.userId), overview = await c.status();
      assertEquals(overview.indexing, { total: 13, indexed: 1, excluded: 1, preparing: 7, attention: 4 });
      assertEquals(overview.daily[29].indexing, { indexed: 1, excluded: 1, preparing: 7, attention: 4 });
      const serialized = JSON.stringify(overview);
      for (const secret of ["private-model", "provider_scope", "effect_id", "known body", ...Object.values(records)]) {
        assertEquals(serialized.includes(secret), false);
      }
      await admin`update app.records set body='revised',version=2 where owner_id=${own.actor.userId} and id=${records.unknown}`;
      const revised = await c.status();
      assertEquals(revised.indexing.attention, 3);
      assertEquals(revised.indexing.preparing, 8);
      await assertRejects(() => asUser(user, own.actor.userId, (tx) => tx`select * from private.passage_effects`));
    } finally {
      await own.cleanup();
    }
  },
);

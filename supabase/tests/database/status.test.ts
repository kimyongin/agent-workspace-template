import { assertEquals, assertRejects } from "@std/assert";
import { Hono } from "hono";
import { statusRoutes } from "../../functions/_shared/adapters/http/status-routes.ts";
import { statusTools } from "../../functions/_shared/adapters/mcp/status-tools.ts";
import type { HttpEnv } from "../../functions/_shared/adapters/http/input.ts";
import { toErrorBody } from "../../functions/_shared/adapters/errors.ts";
import { SqlStatusReader } from "../../functions/_shared/adapters/supabase/status-reader.ts";
import { SqlUnitOfWork } from "../../functions/_shared/adapters/supabase/activity-store.ts";
import { SqlEntityUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-store.ts";
import { SqlExternalEffectLedger } from "../../functions/_shared/adapters/supabase/external-effect.ts";
import { SqlIndexQueue } from "../../functions/_shared/adapters/supabase/index-queue.ts";
import type { StatusOverview } from "../../functions/_shared/contracts/status.ts";
import { taskCreate } from "../../functions/_shared/contracts/task.ts";
import { entityCreate } from "../../functions/_shared/contracts/entity.ts";
import { recordUpdate } from "../../functions/_shared/contracts/record.ts";
import type { Actor } from "../../functions/_shared/core/shared/actor.ts";
import * as activity from "../../functions/_shared/core/activity/application.ts";
import * as entities from "../../functions/_shared/core/entity/application.ts";
import { indexBatch } from "../../functions/_shared/core/search/index-worker.ts";
import { DurablePassageEmbedder } from "../../functions/_shared/core/search/passage-embedder.ts";
import type { ProviderOutcome } from "../../functions/_shared/core/search/external-effect.ts";
import { runInWorkspace } from "../../functions/_shared/adapters/supabase/workspace-context.ts";
import { connect, dbTest, urls } from "./_db.ts";
import { businessRequest, businessWorkspaceFixture } from "./_workspace-business.ts";

const admin = connect(urls.admin, { max: 1 });
const user = connect(urls.pooler, { max: 3, prepare: false });
const workerUrl = new URL(urls.pooler);
workerUrl.username = "app_worker.pooler-dev";
workerUrl.password = encodeURIComponent(Deno.env.get("APP_WORKER_PASSWORD")!);
const worker = connect(workerUrl.href, { max: 3, prepare: false });
const at = "2026-10-10T15:00:00.000Z";
const deps = {
  uow: new SqlUnitOfWork(user),
  clock: { now: () => new Date(at) },
};
const entityDeps = { uow: new SqlEntityUnitOfWork(user) };
const vector = Array.from({ length: 1024 }, (_, n) => n === 0 ? 1 : 0);
const taskGrant = {
  target_kind: "tasks",
  target_id: "*",
  access: "write",
} as const;
type ScopedActor = Actor & { workspaceId: string };
async function fixture() {
  const f = await businessWorkspaceFixture(admin, user);
  await f.grant(f.member, [taskGrant]);
  return f;
}
async function result(actor: ScopedActor, body = "known body") {
  const task = await activity.createTask(
    deps,
    businessRequest(actor),
    taskCreate.parse({ kind: "once", title: "상태 결과" }),
  );
  return await activity.completeTask(deps, businessRequest(actor), task.id, {
    expected_version: task.version,
    body,
  });
}
async function index(
  actor: ScopedActor,
  id: string,
  outcome: ProviderOutcome = { state: "succeeded", vector },
) {
  let sends = 0;
  const batch = await indexBatch(
    new SqlIndexQueue(worker),
    new DurablePassageEmbedder(
      new SqlExternalEffectLedger(worker),
      {
        send: () => {
          sends++;
          return Promise.resolve(outcome);
        },
      },
      "a".repeat(64),
    ),
    { workspace_id: actor.workspaceId, kind: "record", id, limit: 1 },
  );
  assertEquals(batch.claimed, 1);
  assertEquals(sends, 1);
  return batch;
}
// Clock-only fixture faults: all targets and their immutable parent/revision/initiator were created publicly.
async function dateRecords(workspaceId: string, date = at) {
  await admin`update app.records set created_at=${date}::timestamptz,updated_at=${date}::timestamptz where workspace_id=${workspaceId}`;
  await admin`update app.search_index_state set updated_at=${date}::timestamptz where workspace_id=${workspaceId}`;
}
function client(actor: ScopedActor, queriedAt = at) {
  const dependencies = {
    reader: new SqlStatusReader(user),
    clock: { now: () => new Date(queriedAt) },
  };
  const app = new Hono<HttpEnv>();
  app.use("*", async (c, next) => {
    c.set("actor", actor);
    await next();
  });
  app.route("/", statusRoutes(dependencies));
  app.onError((error, c) => {
    const r = toErrorBody(error);
    return c.json(r.body, r.status as 400);
  });
  return {
    app,
    actor,
    tools: statusTools(dependencies),
    status: async () => {
      const response = await app.request("/status");
      assertEquals(response.status, 200);
      return await response.json() as StatusOverview;
    },
  };
}
async function issues(c: ReturnType<typeof client>, cursor?: string) {
  const response = await c.app.request(
    `/status/indexing/issues${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
  );
  assertEquals(response.status, 200);
  const page = await response.json();
  for (const item of page.items) {
    assertEquals(item.kind, "record");
    assertEquals(item.path, `/records/${encodeURIComponent(item.id)}`);
  }
  return page;
}
async function snapshot(workspaceId: string) {
  const [value] = await admin`select jsonb_build_object(
    'state',(select jsonb_agg(to_jsonb(s) order by s.kind,s.id) from app.search_index_state s where workspace_id=${workspaceId}),
    'effects',(select jsonb_agg(to_jsonb(e) order by e.id) from private.passage_effects e where workspace_id=${workspaceId}),
    'chunks',(select count(*) from app.search_chunks where workspace_id=${workspaceId}),
    'queue',(select jsonb_agg(to_jsonb(q) order by msg_id) from pgmq.q_search_index q where message->>'workspace_id'=${workspaceId})
  ) as value`;
  return value.value;
}

dbTest(
  "status stored data: current workspace counts, deleted roots, Seoul midnight and parent grants",
  async () => {
    const f = await fixture();
    try {
      const c = client(f.member), empty = await c.status();
      assertEquals(empty.daily.length, 30);
      assertEquals(empty.period, {
        from: "2026-09-12",
        to: "2026-10-11",
        days: 30,
      });
      assertEquals(empty.daily[0], {
        date: "2026-09-12",
        entities_created: 0,
        tasks_created: 0,
        once_completed: 0,
        records_created: 0,
        indexing: { indexed: 0, preparing: 0, attention: 0, excluded: 0 },
        entity_indexing: { indexed: 0, preparing: 0, attention: 0, excluded: 0 },
      });
      const kind = await f.createKind("상태 자료");
      await f.grantKind(f.member, kind.id, "write");
      const create = (name: string) =>
        entities.createEntity(
          entityDeps,
          businessRequest(f.member),
          entityCreate.parse({
            entity_type_id: kind.id,
            schema_version: 1,
            properties: { prop_1: name },
          }),
        );
      const active = await create("active"), deleted = await create("deleted");
      await entities.deleteEntity(
        entityDeps,
        businessRequest(f.member),
        deleted.id,
        deleted.version,
      );
      const done = await result(f.member);
      const open = await activity.createTask(
        deps,
        businessRequest(f.member),
        taskCreate.parse({ kind: "once", title: "open" }),
      );
      const recurring = await activity.createTask(
        deps,
        businessRequest(f.member),
        taskCreate.parse({
          kind: "recurring",
          title: "repeat",
          recurrence: {
            freq: "daily",
            starts_on: "2026-10-11",
          },
          timezone: "Asia/Seoul",
        }),
      );
      const other = await f.addWorkspace("동일 계정의 다른 공간");
      await f.grant(other.member, [taskGrant]);
      await result(other.member, "foreign private");
      await dateRecords(f.workspaceId, "2026-09-11T14:59:59.999Z");
      await admin`update app.entities set created_at=${at}::timestamptz where workspace_id=${f.workspaceId} and id=${active.id}`;
      await admin`update app.entities set created_at='2026-10-10T14:59:59.999Z' where workspace_id=${f.workspaceId} and id=${deleted.id}`;
      await admin`update app.tasks set created_at=${at}::timestamptz where workspace_id=${f.workspaceId} and id in (${done.task.id},${recurring.id})`;
      await admin`update app.tasks set created_at='2026-09-11T14:59:59.999Z' where workspace_id=${f.workspaceId} and id=${open.id}`;
      await activity.updateRecord(
        deps,
        businessRequest(f.member),
        done.record.id,
        recordUpdate.parse({
          expected_version: done.record.version,
          occurred_at: "2020-01-01T00:00:00Z",
        }),
      );
      await admin`update app.records set created_at=${at}::timestamptz where workspace_id=${f.workspaceId} and id=${done.record.id}`;
      const overview = await c.status();
      assertEquals(overview.entities, { total: 2, active: 1, deleted: 1 });
      assertEquals(overview.tasks, {
        total: 3,
        open: 1,
        done: 1,
        active: 1,
        stopped: 0,
      });
      assertEquals<Record<string, number>>(overview.records, {
        total: 7,
        result: 1,
        change: 6,
      });
      assertEquals(overview.indexing.total, 7); // Record units include generated business changes.
      assertEquals(overview.daily[28].entities_created, 1);
      assertEquals(overview.daily[29], {
        date: "2026-10-11",
        entities_created: 1,
        tasks_created: 2,
        once_completed: 1,
        records_created: 1,
        indexing: { indexed: 0, preparing: 1, attention: 0, excluded: 0 },
        entity_indexing: { indexed: 0, preparing: 0, attention: 0, excluded: 1 },
      });
      assertEquals(await c.tools[0].handler({}, c.actor), overview);
      assertEquals(
        (await (await c.app.request("/status?timezone=UTC")).json()).period.to,
        "2026-10-10",
      );
      await activity.deleteTask(
        deps,
        businessRequest(f.member),
        done.task.id,
        done.task.version,
      );
      const after = await c.status();
      assertEquals(after.tasks.total, 3); // Stored roots remain counted after soft deletion.
      assertEquals(after.records.result, 1); // Immutable parent records remain stored.
      await f.grant(f.member, [{
        target_kind: "entity_type",
        target_id: kind.id,
        access: "read",
      }]);
      const kindOnly = await c.status();
      assertEquals(kindOnly.entities, { total: 2, active: 1, deleted: 1 });
      assertEquals(kindOnly.tasks.total, 0);
      assertEquals<Record<string, number>>(kindOnly.records, {
        total: 3,
        result: 0,
        change: 3,
      });
      await assertRejects(() => activity.getRecord(deps, f.member, done.record.id));
      await f.grant(f.member, [{
        target_kind: "tasks",
        target_id: "*",
        access: "read",
      }]);
      assertEquals((await c.status()).entities.total, 0);
      assertEquals<Record<string, number>>((await c.status()).records, {
        total: 5,
        result: 1,
        change: 4,
      });
      assertEquals<Record<string, number>>(
        (await client(other.member).status()).records,
        {
          total: 2,
          result: 1,
          change: 1,
        },
      );
      await f.grant(f.member, []);
      assertEquals((await c.status()).records.total, 0);
    } finally {
      await f.cleanup();
    }
  },
);

dbTest(
  "indexing wait: threshold, current source revision, missing state and workspace isolation",
  async () => {
    const f = await fixture();
    try {
      const records: Record<
        string,
        Awaited<ReturnType<typeof result>>["record"]
      > = {};
      const queriedAt = "2026-10-11T15:00:00.000Z";
      for (
        const [name, since] of [
          ["boundary", "2026-10-11T14:45:00.000Z"],
          ["recent", "2026-10-11T14:45:00.001Z"],
          ["missing", "2026-10-11T14:40:00.000Z"],
          ["revised", "2026-10-11T14:59:00.000Z"],
          ["failed", "2026-10-10T00:00:00.000Z"],
        ]
      ) {
        records[name] = (await result(f.member)).record;
        await admin`update app.records set created_at=${since}::timestamptz,updated_at=${since}::timestamptz where workspace_id=${f.workspaceId} and id=${
          records[name].id
        }`;
        await admin`update app.search_index_state set updated_at=${since}::timestamptz where workspace_id=${f.workspaceId} and kind='record' and id=${
          records[name].id
        }`;
      }
      // Generated change records are current preparation and do not age into this threshold.
      await admin`update app.records set created_at=${queriedAt}::timestamptz,updated_at=${queriedAt}::timestamptz where workspace_id=${f.workspaceId} and record_kind='change'`;
      await admin`update app.search_index_state s set updated_at=${queriedAt}::timestamptz from app.records r where s.workspace_id=${f.workspaceId} and s.kind='record' and s.id=r.id and r.workspace_id=s.workspace_id and r.record_kind='change'`;
      await admin`delete from app.search_index_state where workspace_id=${f.workspaceId} and kind='record' and id=${records.missing.id}`;
      const revised = await activity.updateRecord(
        deps,
        businessRequest(f.member),
        records.revised.id,
        recordUpdate.parse({
          expected_version: records.revised.version,
          body: "revised current body",
        }),
      );
      await admin`update app.search_index_state set updated_at='2026-10-11T14:59:00Z' where workspace_id=${f.workspaceId} and kind='record' and id=${revised.id}`;
      await admin`update app.search_index_state set state='failed',reason='configuration' where workspace_id=${f.workspaceId} and kind='record' and id=${records.failed.id}`;
      const other = await f.addWorkspace("대기 격리");
      await f.grant(other.member, [taskGrant]);
      await result(other.member);
      await dateRecords(other.workspaceId, "2026-10-10T00:00:00Z");
      const c = client(f.member, queriedAt), status = await c.status();
      assertEquals(status.indexing.waiting, {
        long_waiting: 2,
        oldest_waiting_since: "2026-10-11T14:40:00+00:00",
        threshold_minutes: 15,
      });
      assertEquals(status.indexing.preparing, 9);
      assertEquals(status.indexing.attention, 1);
      assertEquals(
        (await issues(c)).items.map((row: { id: string }) => row.id),
        [records.failed.id],
      );
      assertEquals(await c.tools[0].handler({}, c.actor), status);
      await admin`update app.search_index_state set updated_at=${queriedAt}::timestamptz where workspace_id=${f.workspaceId} and kind='record' and id=${records.boundary.id}`;
      await activity.deleteRecord(
        deps,
        businessRequest(f.member),
        records.missing.id,
        records.missing.version,
      );
      const after = await c.status();
      assertEquals(after.indexing.waiting.long_waiting, 0);
      assertEquals(
        after.indexing.waiting.oldest_waiting_since,
        "2026-10-11T14:45:00.001+00:00",
      );
      assertEquals(
        (await client(other.member, queriedAt).status()).indexing.waiting
          .long_waiting,
        2,
      );
    } finally {
      await f.cleanup();
    }
  },
);

dbTest(
  "status indexing: real scoped durable effects, current revision, expired leases and pure safe projection",
  async () => {
    const f = await fixture();
    try {
      const records: Record<
        string,
        Awaited<ReturnType<typeof result>>["record"]
      > = {};
      const names = [
        "indexed",
        "excluded",
        "missing",
        "stale_revision",
        "unknown",
        "expired",
        "running",
        "transient",
        "configuration",
        "held",
        "split_parent",
      ];
      for (const name of names) {
        const record = records[name] = (await result(f.member)).record;
        if (name === "missing") {
          await admin`delete from app.search_index_state where workspace_id=${f.workspaceId} and kind='record' and id=${record.id}`;
          continue;
        }
        if (name === "split_parent") {
          const batch = await indexBatch(
            new SqlIndexQueue(worker),
            new DurablePassageEmbedder(
              new SqlExternalEffectLedger(worker),
              {
                send: (text) =>
                  Promise.resolve(
                    text.length > 5 ? { state: "failed", reason: "input_limit" } : { state: "succeeded", vector },
                  ),
              },
              "a".repeat(64),
            ),
            {
              workspace_id: f.workspaceId,
              kind: "record",
              id: record.id,
              limit: 1,
            },
          );
          assertEquals(batch.indexed, 1);
          // The actual split child becomes live; the actual input-limit parent is not a problem.
          await admin`update private.passage_effects set state='running',reason=null,result=null,lease_until='2026-10-10T15:01:30Z'
          where workspace_id=${f.workspaceId} and source_kind='record' and source_id=${record.id} and state='succeeded'`;
        } else {
          const outcome: ProviderOutcome = name === "indexed" || name === "excluded"
            ? { state: "succeeded", vector }
            : name === "transient" || name === "configuration"
            ? { state: "failed", reason: name }
            : { state: "unknown", reason: "provider_unknown" };
          const batch = await index(f.member, record.id, outcome);
          if (name === "indexed") assertEquals(batch.indexed, 1);
        }
        if (name === "stale_revision") {
          records[name] = await activity.updateRecord(
            deps,
            businessRequest(f.member),
            record.id,
            recordUpdate.parse({
              expected_version: record.version,
              body: "new source body",
            }),
          );
          continue; // Old real effects must not affect the freshly queued source revision/hash.
        }
        if (name === "excluded") {
          await admin`update app.search_index_state set state='excluded',reason=null where workspace_id=${f.workspaceId} and kind='record' and id=${record.id}`;
        } else if (name !== "indexed") {
          await admin`update app.search_index_state set state='pending',reason=${
            name === "held" ? "retry_exhausted" : null
          } where workspace_id=${f.workspaceId} and kind='record' and id=${record.id}`;
        }
        if (name === "expired" || name === "running") {
          await admin`update private.passage_effects set state='running',reason=null,lease_until=${
            name === "running" ? "2026-10-10T15:01:30Z" : "2026-10-10T14:59:59Z"
          }::timestamptz
          where workspace_id=${f.workspaceId} and source_kind='record' and source_id=${record.id}`;
        }
        if (name === "held") {
          await admin`update private.passage_effects set attempts=5 where workspace_id=${f.workspaceId} and source_kind='record' and source_id=${record.id}`;
        }
      }
      await dateRecords(f.workspaceId);
      const c = client(f.member),
        before = await snapshot(f.workspaceId),
        overview = await c.status();
      const { waiting, ...counts } = overview.indexing;
      assertEquals(counts, {
        total: 22,
        indexed: 1,
        excluded: 1,
        preparing: 16,
        attention: 4,
      });
      assertEquals(waiting.long_waiting, 0);
      assertEquals(overview.daily[29].indexing, {
        indexed: 1,
        excluded: 1,
        preparing: 16,
        attention: 4,
      });
      const problems = await issues(c);
      assertEquals(
        problems.items.map((item: { id: string }) => item.id).sort(),
        [
          records.unknown.id,
          records.expired.id,
          records.configuration.id,
          records.held.id,
        ].sort(),
      );
      assertEquals(problems.next_cursor, null);
      assertEquals(
        problems.items.find((item: { id: string }) => item.id === records.unknown.id).chunks,
        { total: 1, succeeded: 0, preparing: 0, unknown: 1, failed: 0 },
      );
      assertEquals(await c.tools[0].handler({}, c.actor), overview);
      assertEquals(await c.tools[1].handler({}, c.actor), problems);
      assertEquals(await snapshot(f.workspaceId), before); // Reads do not consume/retry/write source or effects.
      for (
        const secret of [
          "effect_id",
          "provider_scope",
          "llama-text-embed-v2",
          "vector",
          "input_hash",
        ]
      ) {
        assertEquals(JSON.stringify(problems).includes(secret), false);
      }
      for (
        const secret of [
          "llama-text-embed-v2",
          "provider_scope",
          "effect_id",
          "known body",
          ...Object.values(records).map((record) => record.id),
        ]
      ) {
        assertEquals(JSON.stringify(overview).includes(secret), false);
      }
      await activity.updateRecord(
        deps,
        businessRequest(f.member),
        records.unknown.id,
        recordUpdate.parse({
          expected_version: records.unknown.version,
          body: "revised",
        }),
      );
      const revised = await c.status();
      assertEquals(revised.indexing.attention, 3);
      assertEquals(revised.indexing.preparing, 17);
      await assertRejects(() =>
        runInWorkspace(
          user,
          f.member,
          { mode: "business", requirements: [] },
          (tx) => tx`select * from private.passage_effects`,
        )
      );
    } finally {
      await f.cleanup();
    }
  },
);

dbTest(
  "indexing issues: five-row pages, equal timestamps, foreign workspace cursor, Unicode and SQL ACL",
  async () => {
    const f = await fixture();
    try {
      const ids: string[] = [];
      for (let n = 0; n < 11; n++) {
        const record = (await result(f.member, "problem")).record;
        ids.push(record.id);
        await admin`update app.search_index_state set state='failed',reason='configuration' where workspace_id=${f.workspaceId} and kind='record' and id=${record.id}`;
      }
      await dateRecords(f.workspaceId);
      const c = client(f.member), first = await issues(c);
      const sorted = [...ids].sort().reverse();
      assertEquals(
        first.items.map((row: { id: string }) => row.id),
        sorted.slice(0, 5),
      );
      const second = await issues(c, first.next_cursor),
        last = await issues(c, second.next_cursor);
      assertEquals(
        second.items.map((row: { id: string }) => row.id),
        sorted.slice(5, 10),
      );
      assertEquals(
        last.items.map((row: { id: string }) => row.id),
        sorted.slice(10),
      );
      assertEquals(last.next_cursor, null);
      const other = await f.addWorkspace("커서 격리");
      await f.grant(other.member, [{
        target_kind: "tasks",
        target_id: "*",
        access: "read",
      }]);
      const foreign = client(other.member);
      assertEquals(
        (await foreign.app.request(
          `/status/indexing/issues?cursor=${encodeURIComponent(first.next_cursor)}`,
        )).status,
        400,
      );
      assertEquals(await issues(foreign), { items: [], next_cursor: null });
      assertEquals(
        await c.tools[1].handler({ cursor: first.next_cursor }, c.actor),
        second,
      );
      // A valid old cursor never restores revoked task-parent rows or exposes their count.
      await f.grant(f.member, []);
      assertEquals(await issues(c, first.next_cursor), {
        items: [],
        next_cursor: null,
      });
      await f.grant(f.member, [taskGrant]);
      const emoji = (await result(f.member, "😀".repeat(110))).record;
      await admin`update app.records set created_at='2026-10-11T00:00:00Z' where workspace_id=${f.workspaceId} and id=${emoji.id}`;
      await admin`update app.search_index_state set state='failed',reason='configuration' where workspace_id=${f.workspaceId} and kind='record' and id=${emoji.id}`;
      assertEquals((await issues(c)).items[0].title, "😀".repeat(100));
      const getter = await admin`select to_regprocedure('app.record_passage_effect_status(text)') as name`;
      assertEquals(getter[0].name, null);
      const grants =
        await admin`select has_function_privilege('app_user','app.status_indexing_issues(text,timestamptz,timestamptz,text)','EXECUTE') as own,
      has_function_privilege('app_worker','app.status_indexing_issues(text,timestamptz,timestamptz,text)','EXECUTE') as worker,
      has_function_privilege('authenticated','app.status_indexing_issues(text,timestamptz,timestamptz,text)','EXECUTE') as direct`;
      assertEquals(grants[0], { own: true, worker: false, direct: false });
    } finally {
      await f.cleanup();
    }
  },
);

dbTest(
  "status timezone: canonical DST alias and public record dates, numeric offsets rejected",
  async () => {
    const f = await fixture();
    try {
      const boundary = "2026-10-10T05:00:00.000Z",
        record = (await result(f.member, "Chicago midnight")).record;
      await dateRecords(f.workspaceId, "2026-09-01T00:00:00Z");
      await admin`update app.records set created_at=${boundary}::timestamptz where workspace_id=${f.workspaceId} and id=${record.id}`;
      const c = client(f.member, boundary),
        response = await c.app.request("/status?timezone=CST");
      assertEquals(response.status, 200);
      const alias = await response.json();
      assertEquals(alias.timezone, "America/Chicago");
      assertEquals(alias.period.to, "2026-10-10");
      assertEquals(alias.daily.at(-1).date, "2026-10-10");
      assertEquals(alias.daily.at(-1).records_created, 1);
      assertEquals(
        await (await c.app.request("/status?timezone=America%2FChicago"))
          .json(),
        alias,
      );
      assertEquals(
        await c.tools[0].handler({ timezone: "CST" }, c.actor),
        alias,
      );
      assertEquals(
        (await c.app.request("/status?timezone=%2B05%3A30")).status,
        400,
      );
    } finally {
      await f.cleanup();
    }
  },
);

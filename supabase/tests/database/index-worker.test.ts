// Workspace sources use the current business contract; #516 owns the search/worker consumer conversion.
import { SqlExternalEffectLedger } from "../../functions/_shared/adapters/supabase/external-effect.ts";
import { DurablePassageEmbedder } from "../../functions/_shared/core/search/passage-embedder.ts";
import type { Embedder, IndexQueue, IndexScope } from "../../functions/_shared/core/search/index-worker.ts";
import { businessRequest, businessWorkspaceFixture } from "./_workspace-business.ts";
import { runInWorkspace } from "../../functions/_shared/adapters/supabase/workspace-context.ts";
import { assertEquals, assertMatch, assertRejects } from "@std/assert";
import { SqlIndexQueue } from "../../functions/_shared/adapters/supabase/index-queue.ts";
import { SqlUnitOfWork } from "../../functions/_shared/adapters/supabase/activity-store.ts";
import { SqlSearchUnitOfWork } from "../../functions/_shared/adapters/supabase/search-store.ts";
import { recordUpdate } from "../../functions/_shared/contracts/record.ts";
import { taskCreate } from "../../functions/_shared/contracts/task.ts";
import { searchInput } from "../../functions/_shared/contracts/search.ts";
import * as activity from "../../functions/_shared/core/activity/application.ts";
import { EmbeddingError, indexBatch, type IndexedChunk } from "../../functions/_shared/core/search/index-worker.ts";
import { search } from "../../functions/_shared/core/search/application.ts";
import { SEARCH_PIPELINE } from "../../functions/_shared/core/search/config.ts";
import { asUser, connect, dbTest, outcome, urls } from "./_db.ts";

const admin = connect(urls.admin, { max: 1 }), user = connect(urls.pooler, { max: 3, prepare: false });
const workerUrl = new URL(urls.pooler);
workerUrl.username = "app_worker.pooler-dev";
workerUrl.password = encodeURIComponent(Deno.env.get("APP_WORKER_PASSWORD")!);
const worker = connect(workerUrl.href, { max: 3, prepare: false }), queue = new SqlIndexQueue(worker);
const fixture = await businessWorkspaceFixture(admin, user);
await fixture.grant(fixture.member, [{ target_kind: "tasks", target_id: "*", access: "write" }]);
const A = fixture.member;
const otherWorkspace = await fixture.addWorkspace("격리된 검색 검증");
await fixture.grant(otherWorkspace.member, [{ target_kind: "tasks", target_id: "*", access: "write" }]);
const foreign = { actor: otherWorkspace.member };
const deps = { uow: new SqlUnitOfWork(user), clock: { now: () => new Date() } };
const vector = Array.from({ length: 1024 }, (_, i) => i === 0 ? 1 : 0);
const state = async (id: string) =>
  (await admin`select * from app.search_index_state where workspace_id=${A.workspaceId} and id=${id}`)[0];
async function completeFixtureTask(body: string) {
  const task = await activity.createTask(
    deps,
    businessRequest(A),
    taskCreate.parse({ kind: "once", title: "색인 작업 결과" }),
  );
  return (await activity.completeTask(deps, businessRequest(A), task.id, { expected_version: task.version, body }))
    .record;
}
const update = (id: string, version: number, body: string) =>
  activity.updateRecord(deps, businessRequest(A), id, recordUpdate.parse({ expected_version: version, body }));
const scope = (id: string) => ({ limit: 1, kind: "record", id });

const ledger = new SqlExternalEffectLedger(worker);
const providerScope = "a".repeat(64);
function runBatch(q: IndexQueue, embedder: Embedder, input: IndexScope) {
  return indexBatch(
    q,
    new DurablePassageEmbedder(ledger, {
      async send(text) {
        try {
          return { state: "succeeded", vector: await embedder.embed(text, "passage") };
        } catch (error) {
          if (!(error instanceof EmbeddingError)) throw error;
          return error.category === "invalid_response"
            ? { state: "unknown", reason: "invalid_response" }
            : { state: "failed", reason: error.category };
        }
      },
    }, providerScope),
    input,
  );
}
async function retryReady(id: string) {
  await admin`update pgmq.q_search_index set vt=now()-interval '1 second' where msg_id=${id}`;
  await admin`update private.passage_effects e set next_attempt_at=now()-interval '1 second',lease_until=now()-interval '1 second'
    where e.record_id in (select id from app.records where workspace_id=${A.workspaceId})
      and e.record_id=(select message->>'id' from pgmq.q_search_index where msg_id=${id}::bigint)`;
}

dbTest("record worker: complete generation, duplicate delivery, body edit/delete during embedding", async () => {
  const item = await completeFixtureTask("처음😀본문".repeat(400) + "마지막 근거");
  assertEquals((await runBatch(queue, { embed: () => Promise.resolve(vector) }, scope(item.id))).indexed, 1);
  assertEquals((await state(item.id)).state, "indexed");
  assertEquals((await runBatch(queue, { embed: () => Promise.resolve(vector) }, scope(item.id))).claimed, 0);
  await update(item.id, 1, "이전 본문");
  let started = Promise.withResolvers<void>(), released = Promise.withResolvers<number[]>();
  const delayed = {
    embed: () => {
      started.resolve();
      return released.promise;
    },
  };
  const old = runBatch(queue, delayed, scope(item.id));
  await started.promise;
  await update(item.id, 2, "최신 본문");
  released.resolve(vector);
  assertEquals((await old).stale, 1);
  assertEquals((await state(item.id)).state, "pending");
  assertEquals((await admin`select * from app.search_chunks where record_id=${item.id}`).length, 0);
  const [claim] = await queue.claim(scope(item.id));
  assertEquals((await queue.prepare(claim.msg_id, SEARCH_PIPELINE))?.body, "최신 본문");
  const chunks: IndexedChunk[] = [{ start: 0, end: 5, text: "최신 본문", vector }];
  assertEquals(await queue.finish(claim.msg_id, SEARCH_PIPELINE, "indexed", null, chunks), true);
  assertEquals(await queue.finish(claim.msg_id, SEARCH_PIPELINE, "indexed", null, chunks), false);
  await update(item.id, 3, "삭제 전 본문");
  started = Promise.withResolvers<void>();
  released = Promise.withResolvers<number[]>();
  const late = runBatch(queue, delayed, scope(item.id));
  await started.promise;
  await activity.deleteRecord(deps, businessRequest(A), item.id, 4);
  released.resolve(vector);
  assertEquals((await late).stale, 1);
  assertEquals(await state(item.id), undefined);
  assertEquals((await admin`select * from app.search_chunks where record_id=${item.id}`).length, 0);
});

dbTest(
  "record worker: partial failure/retry, malformed coverage rollback, forged queue and role boundaries",
  async () => {
    const item = await completeFixtureTask("가".repeat(900));
    let calls = 0;
    assertEquals(
      (await runBatch(queue, {
        embed: () => ++calls === 1 ? Promise.resolve(vector) : Promise.reject(new EmbeddingError("transient")),
      }, scope(item.id))).retry,
      1,
    );
    const first = await state(item.id);
    assertEquals(first.state, "pending");
    assertEquals((await admin`select * from app.search_chunks where record_id=${item.id}`).length, 0);
    for (let count = 2; count <= 5; count++) {
      await retryReady(String(first.message_id));
      const result = await runBatch(queue, {
        embed: () => Promise.reject(new EmbeddingError("transient")),
      }, scope(item.id));
      assertEquals(count === 5 ? result.failed : result.retry, 1);
    }
    assertEquals((await state(item.id)).reason, "retry_exhausted");
    await update(item.id, 1, "새 본문😀");
    const [claim] = await queue.claim(scope(item.id));
    await assertRejects(() =>
      queue.finish(claim.msg_id, SEARCH_PIPELINE, "indexed", null, [{ start: 0, end: 1, text: "새", vector }])
    );
    assertEquals((await state(item.id)).state, "pending");
    assertEquals((await admin`select * from app.search_chunks where record_id=${item.id}`).length, 0);
    const current = await state(item.id);
    const [forged] = await admin`select pgmq.send('search_index',${
      admin.json({
        workspace_id: foreign.actor.workspaceId,
        initiated_by: foreign.actor.userId,
        kind: "record",
        id: item.id,
        input_hash: current.input_hash,
        pipeline: SEARCH_PIPELINE,
      })
    }) as id`;
    assertEquals(await queue.prepare(String(forged.id), SEARCH_PIPELINE), null);
    assertEquals((await state(item.id)).message_id, current.message_id);
    assertEquals(
      (await runInWorkspace(
        user,
        foreign.actor,
        { mode: "business", requirements: [] },
        (tx) => tx`select * from app.search_chunks`,
      )).length,
      0,
    );
    for (
      const query of [
        "select * from app.records",
        "select * from app.search_chunks",
        "select * from pgmq.q_search_index",
        "set role app_user",
      ]
    ) {
      assertMatch(await outcome(worker.unsafe(query)), /^42501/);
    }
    assertMatch(await outcome(asUser(user, A.userId, (tx) => tx`select app.claim_search_index(1)`)), /^42501/);
    for (const role of ["anon", "authenticated"]) {
      assertMatch(
        await outcome(admin.begin(async (tx) => {
          await tx.unsafe(`set local role ${role}`);
          await tx`select app.claim_search_index(1)`;
        })),
        /^42501/,
      );
    }
    await activity.deleteRecord(deps, businessRequest(A), item.id, 2);
  },
);

dbTest("durable worker reuses successful sibling after partial failure and finish response loss", async () => {
  const item = await completeFixtureTask("가".repeat(900));
  let sends = 0;
  const embedder: Embedder = {
    embed: () => ++sends === 2 ? Promise.reject(new EmbeddingError("transient")) : Promise.resolve(vector),
  };
  assertEquals((await runBatch(queue, embedder, scope(item.id))).retry, 1);
  const current = await state(item.id);
  await retryReady(String(current.message_id));
  let failFinish = true;
  const faulty: IndexQueue = {
    claim: (s) => queue.claim(s),
    prepare: (id, p) => queue.prepare(id, p),
    finish: async (...args) => {
      if (failFinish) {
        failFinish = false;
        throw new Error("injected final apply failure");
      }
      return await queue.finish(...args);
    },
  };
  await assertRejects(() => runBatch(faulty, embedder, scope(item.id)));
  assertEquals(sends, 3);
  await retryReady(String(current.message_id));
  assertEquals((await runBatch(queue, embedder, scope(item.id))).indexed, 1);
  assertEquals(sends, 3);
  await activity.deleteRecord(deps, businessRequest(A), item.id, 1);
});

dbTest("recursive input limit children reuse successful sibling and failed parent", async () => {
  const item = await completeFixtureTask("abcdefgh");
  const sent: string[] = [];
  let rightFailed = false;
  const embedder: Embedder = {
    embed: (text) => {
      sent.push(text);
      if (text.length > 4) return Promise.reject(new EmbeddingError("input_limit"));
      if (text === "efgh" && !rightFailed) {
        rightFailed = true;
        return Promise.reject(new EmbeddingError("transient"));
      }
      return Promise.resolve(vector);
    },
  };
  assertEquals((await runBatch(queue, embedder, scope(item.id))).retry, 1);
  await retryReady(String((await state(item.id)).message_id));
  assertEquals((await runBatch(queue, embedder, scope(item.id))).indexed, 1);
  assertEquals(sent, ["abcdefgh", "abcd", "efgh", "efgh"]);
  await activity.deleteRecord(deps, businessRequest(A), item.id, 1);
});

dbTest("competing worker cannot send active passage and lost committed finish response stays indexed", async () => {
  const item = await completeFixtureTask("경쟁 검증");
  const started = Promise.withResolvers<void>(), release = Promise.withResolvers<number[]>();
  let sends = 0;
  const embedder: Embedder = {
    embed: () => {
      sends++;
      started.resolve();
      return release.promise;
    },
  };
  const first = runBatch(queue, embedder, scope(item.id));
  await started.promise;
  const current = await state(item.id);
  const competing: IndexQueue = {
    claim: () => Promise.resolve([{ msg_id: String(current.message_id), read_ct: 100 }]),
    prepare: (id, p) => queue.prepare(id, p),
    finish: (...a) => queue.finish(...a),
  };
  assertEquals((await runBatch(competing, embedder, scope(item.id))).retry, 1);
  assertEquals(sends, 1);
  release.resolve(vector);
  assertEquals((await first).indexed, 1);
  await update(item.id, 1, "응답 유실 검증");
  const lost: IndexQueue = {
    claim: (input) => queue.claim(input),
    prepare: (id, p) => queue.prepare(id, p),
    finish: async (...a) => {
      await queue.finish(...a);
      throw new Error("lost committed response");
    },
  };
  await assertRejects(() => runBatch(lost, { embed: () => Promise.resolve(vector) }, scope(item.id)));
  assertEquals((await state(item.id)).state, "indexed");
  assertEquals((await runBatch(queue, embedder, scope(item.id))).claimed, 0);
  await activity.deleteRecord(deps, businessRequest(A), item.id, 2);
});

dbTest("unknown passage exhausts five durable sends and fresh queue delivery cannot reset it", async () => {
  const item = await completeFixtureTask("불명 응답");
  let sends = 0;
  const embedder: Embedder = {
    embed: () => {
      sends++;
      return Promise.reject(new EmbeddingError("invalid_response"));
    },
  };
  for (let n = 1; n <= 5; n++) {
    const current = await state(item.id);
    await retryReady(String(current.message_id));
    const result = await runBatch(queue, embedder, scope(item.id));
    assertEquals(n === 5 ? result.held : result.retry, 1);
  }
  assertEquals(sends, 5);
  assertEquals((await state(item.id)).state, "pending");
  assertEquals((await state(item.id)).reason, "retry_exhausted");
  const heldSource = await state(item.id);
  await runInWorkspace(
    user,
    A,
    { mode: "business", requirements: [{ target_kind: "tasks", target_id: "*", access: "write" }] },
    (tx) => tx`select app.enqueue_search_index('record',${item.id},${heldSource.input_hash},${SEARCH_PIPELINE})`,
  );
  await retryReady(String((await state(item.id)).message_id));
  assertEquals((await runBatch(queue, embedder, scope(item.id))).held, 1);
  assertEquals(sends, 5);
  assertEquals((await state(item.id)).reason, "retry_exhausted");
  await activity.deleteRecord(deps, businessRequest(A), item.id, 1);
});

dbTest("latest task content creates no task vector job and remains keyword searchable", async () => {
  const token = crypto.randomUUID();
  const task = await activity.createTask(
    deps,
    businessRequest(A),
    taskCreate.parse({ title: token, body: "현재 본문", kind: "once" }),
  );
  assertEquals(await state(task.id), undefined);
  assertEquals(
    (await runBatch(queue, {
      embed: () => {
        throw new Error("must not embed task");
      },
    }, { limit: 1, kind: "task", id: task.id })).claimed,
    0,
  );
  const result = await search(
    { uow: new SqlSearchUnitOfWork(user) },
    A,
    searchInput.parse({ query: token, kinds: ["task"] }),
  );
  assertEquals(result.items[0].id, task.id);
  assertEquals(result.items[0].match, "keyword");
  assertEquals(result.semantic_coverage, { pending: 0, excluded: 0 });
});
dbTest("index-worker fixture cleanup", async () => {
  await fixture.cleanup();
});

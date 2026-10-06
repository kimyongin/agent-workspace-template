import { assertEquals, assertMatch, assertRejects } from "@std/assert";
import { SqlIndexQueue } from "../../functions/_shared/adapters/supabase/index-queue.ts";
import { SqlUnitOfWork } from "../../functions/_shared/adapters/supabase/activity-store.ts";
import { SqlSearchUnitOfWork } from "../../functions/_shared/adapters/supabase/search-store.ts";
import { recordCreate, recordUpdate } from "../../functions/_shared/contracts/record.ts";
import { taskCreate } from "../../functions/_shared/contracts/task.ts";
import { searchInput } from "../../functions/_shared/contracts/search.ts";
import * as activity from "../../functions/_shared/core/activity/application.ts";
import { EmbeddingError, indexBatch, type IndexedChunk } from "../../functions/_shared/core/search/index-worker.ts";
import { search } from "../../functions/_shared/core/search/application.ts";
import { SEARCH_PIPELINE } from "../../functions/_shared/core/search/config.ts";
import { asUser, connect, dbTest, fixtureOwner, outcome, urls } from "./_db.ts";

const admin = connect(urls.admin, { max: 1 }), user = connect(urls.pooler, { max: 3, prepare: false });
const workerUrl = new URL(urls.pooler);
workerUrl.username = "app_worker.pooler-dev";
workerUrl.password = encodeURIComponent(Deno.env.get("APP_WORKER_PASSWORD")!);
const worker = connect(workerUrl.href, { max: 3, prepare: false }), queue = new SqlIndexQueue(worker);
const fixture = await fixtureOwner(admin), foreign = await fixtureOwner(admin), A = fixture.actor;
const deps = { uow: new SqlUnitOfWork(user), clock: { now: () => new Date() } };
const vector = Array.from({ length: 1024 }, (_, i) => i === 0 ? 1 : 0);
const state = async (id: string) => (await admin`select * from app.search_index_state where id=${id}`)[0];
const create = (body: string) => activity.createRecord(deps, A, recordCreate.parse({ id: crypto.randomUUID(), body }));
const update = (id: string, version: number, body: string) =>
  activity.updateRecord(deps, A, id, recordUpdate.parse({ expected_version: version, body }));
const scope = (id: string) => ({ limit: 1, owner_id: A.userId, kind: "record", id });

dbTest("record worker: complete generation, duplicate delivery, body edit/delete during embedding", async () => {
  const item = await create("처음😀본문".repeat(400) + "마지막 근거");
  assertEquals((await indexBatch(queue, { embed: () => Promise.resolve(vector) }, scope(item.id))).indexed, 1);
  assertEquals((await state(item.id)).state, "indexed");
  assertEquals((await indexBatch(queue, { embed: () => Promise.resolve(vector) }, scope(item.id))).claimed, 0);
  await update(item.id, 1, "이전 본문");
  let started = Promise.withResolvers<void>(), released = Promise.withResolvers<number[]>();
  const delayed = {
    embed: () => {
      started.resolve();
      return released.promise;
    },
  };
  const old = indexBatch(queue, delayed, scope(item.id));
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
  const late = indexBatch(queue, delayed, scope(item.id));
  await started.promise;
  await activity.deleteRecord(deps, A, item.id, 4);
  released.resolve(vector);
  assertEquals((await late).stale, 1);
  assertEquals(await state(item.id), undefined);
  assertEquals((await admin`select * from app.search_chunks where record_id=${item.id}`).length, 0);
});

dbTest(
  "record worker: partial failure/retry, malformed coverage rollback, forged queue and role boundaries",
  async () => {
    const item = await create("가".repeat(900));
    let calls = 0;
    assertEquals(
      (await indexBatch(queue, {
        embed: () => ++calls === 1 ? Promise.resolve(vector) : Promise.reject(new EmbeddingError("transient")),
      }, scope(item.id))).retry,
      1,
    );
    const first = await state(item.id);
    assertEquals(first.state, "pending");
    assertEquals((await admin`select * from app.search_chunks where record_id=${item.id}`).length, 0);
    for (let count = 2; count <= 5; count++) {
      await admin`update pgmq.q_search_index set vt=now()-interval '1 second' where msg_id=${first.message_id}`;
      const result = await indexBatch(queue, {
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
        owner_id: foreign.actor.userId,
        kind: "record",
        id: item.id,
        input_hash: current.input_hash,
        pipeline: SEARCH_PIPELINE,
      })
    }) as id`;
    assertEquals(await queue.prepare(String(forged.id), SEARCH_PIPELINE), null);
    assertEquals((await state(item.id)).message_id, current.message_id);
    assertEquals(
      (await asUser(user, foreign.actor.userId, (tx) => tx`select * from app.search_chunks`)).length,
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
    await activity.deleteRecord(deps, A, item.id, 2);
  },
);

dbTest("latest task content creates no task vector job and remains keyword searchable", async () => {
  const token = crypto.randomUUID();
  const task = await activity.createTask(
    deps,
    A,
    taskCreate.parse({ id: crypto.randomUUID(), title: token, body: "현재 본문", kind: "once" }),
  );
  assertEquals(await state(task.id), undefined);
  assertEquals(
    (await indexBatch(queue, {
      embed: () => {
        throw new Error("must not embed task");
      },
    }, { limit: 1, owner_id: A.userId, kind: "task", id: task.id })).claimed,
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
  await foreign.cleanup();
});

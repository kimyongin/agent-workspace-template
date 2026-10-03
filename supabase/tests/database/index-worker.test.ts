import { assertEquals, assertMatch } from "@std/assert";
import { SqlIndexQueue } from "../../functions/_shared/adapters/supabase/index-queue.ts";
import { SqlUnitOfWork } from "../../functions/_shared/adapters/supabase/activity-store.ts";
import { SqlPrincipleUnitOfWork } from "../../functions/_shared/adapters/supabase/principle-store.ts";
import { taskCreate, taskUpdate } from "../../functions/_shared/contracts/task.ts";
import { recordCreate, recordUpdate } from "../../functions/_shared/contracts/record.ts";
import { principleCreate, principleUpdate } from "../../functions/_shared/contracts/principle.ts";
import * as activity from "../../functions/_shared/core/activity/application.ts";
import * as principles from "../../functions/_shared/core/principles/application.ts";
import { EmbeddingError, indexBatch } from "../../functions/_shared/core/search/index-worker.ts";
import { SEARCH_PIPELINE } from "../../functions/_shared/core/search/config.ts";
import { asUser, connect, dbTest, devUsers, outcome, urls } from "./_db.ts";

const admin = connect(urls.admin, { max: 1 }), user = connect(urls.pooler, { max: 3, prepare: false });
const workerUrl = new URL(urls.pooler);
workerUrl.username = "app_worker.pooler-dev";
workerUrl.password = encodeURIComponent(Deno.env.get("APP_WORKER_PASSWORD")!);
const worker = connect(workerUrl.href, { max: 3, prepare: false });
const queue = new SqlIndexQueue(worker), users = await devUsers(admin), A = { userId: users.a };
const deps = { uow: new SqlUnitOfWork(user), clock: { now: () => new Date() } },
  p = { uow: new SqlPrincipleUnitOfWork(user) };
const vector = Array.from({ length: 1024 }, (_, i) => i === 0 ? 1 : 0);
type Kind = "task" | "record" | "principle";
const make = (kind: Kind) => {
  const input = { title: crypto.randomUUID(), summary: "현재 요약", body: "본문 전용 비공개 표식" };
  return kind === "task"
    ? activity.createTask(deps, A, taskCreate.parse({ ...input, kind: "once" }))
    : kind === "record"
    ? activity.createRecord(deps, A, recordCreate.parse(input))
    : principles.createPrinciple(p, A, principleCreate.parse(input));
};
const change = (kind: Kind, id: string, version: number, fields: Record<string, string>) => {
  const input = { expected_version: version, ...fields };
  return kind === "task"
    ? activity.updateTask(deps, A, id, taskUpdate.parse(input))
    : kind === "record"
    ? activity.updateRecord(deps, A, id, recordUpdate.parse(input))
    : principles.updatePrinciple(p, A, id, principleUpdate.parse(input));
};
const remove = (kind: Kind, id: string, version: number) =>
  kind === "task"
    ? activity.deleteTask(deps, A, id, version)
    : kind === "record"
    ? activity.deleteRecord(deps, A, id, version)
    : principles.deletePrinciple(p, A, id, version);
const state = async (kind: Kind, id: string) =>
  (await admin`select *,embedding::text as saved_vector from app.search_index_state where kind=${kind} and id=${id}`)[
    0
  ];

for (const kind of ["task", "record", "principle"] as const) {
  dbTest(`worker ${kind}: 실제 역할·단일 벡터·재전달·본문 억제·수정/삭제 늦은 결과`, async () => {
    const item = await make(kind), scope = { limit: 1, owner_id: users.a, kind, id: item.id };
    let calls = 0;
    const embedder = {
      embed: (text: string, type: string) => {
        calls++;
        assertEquals(text, `${item.title}\n${item.summary}`);
        assertEquals(type, "passage");
        return Promise.resolve(vector);
      },
    };
    const [claim] = await queue.claim(scope);
    assertEquals((await queue.claim(scope)).length, 0);
    assertEquals((await queue.prepare(claim.msg_id, SEARCH_PIPELINE))?.summary, item.summary);
    assertEquals(await queue.finish(claim.msg_id, SEARCH_PIPELINE, "indexed", null, vector), true);
    assertEquals(await queue.finish(claim.msg_id, SEARCH_PIPELINE, "indexed", null, vector), false);
    assertEquals((await state(kind, item.id)).state, "indexed");
    assertEquals((await state(kind, item.id)).saved_vector, JSON.stringify(vector));
    await change(kind, item.id, 1, { body: "본문만 변경" });
    assertEquals((await indexBatch(queue, embedder, scope)).claimed, 0);
    assertEquals(calls, 0);
    await change(kind, item.id, 2, { summary: "첫 갱신" });
    let started = Promise.withResolvers<void>(), released = Promise.withResolvers<number[]>();
    const delayed = {
      embed: (_text: string, _type: "passage" | "query") => {
        started.resolve();
        return released.promise;
      },
    };
    const old = indexBatch(queue, delayed, scope);
    await started.promise;
    await change(kind, item.id, 3, { summary: "최신 갱신" });
    released.resolve(vector);
    assertEquals((await old).stale, 1);
    assertEquals((await state(kind, item.id)).state, "pending");
    const current = await indexBatch(queue, {
      embed: (text) => {
        assertEquals(text, `${item.title}\n최신 갱신`);
        return Promise.resolve(vector);
      },
    }, scope);
    assertEquals(current.indexed, 1);
    await change(kind, item.id, 4, { summary: "삭제 전" });
    started = Promise.withResolvers<void>();
    released = Promise.withResolvers<number[]>();
    const late = indexBatch(queue, delayed, scope);
    await started.promise;
    await remove(kind, item.id, 5);
    released.resolve(vector);
    assertEquals((await late).stale, 1);
    assertEquals(await state(kind, item.id), undefined);
  });
}
dbTest("worker 실패: 입력 제외·제한 재시도·구 파이프라인/변조 메시지·역할 경계", async () => {
  const item = await make("record"), scope = { limit: 1, owner_id: users.a, kind: "record", id: item.id };
  const fail = (category: "transient" | "input_limit" | "configuration") => ({
    embed: () => Promise.reject(new EmbeddingError(category)),
  });
  assertEquals((await indexBatch(queue, fail("transient"), scope)).retry, 1);
  const first = await state("record", item.id);
  assertEquals(first.state, "pending");
  assertEquals((await queue.claim(scope)).length, 0);
  for (let count = 2; count <= 5; count++) {
    await admin`update pgmq.q_search_index set vt=now()-interval '1 second' where msg_id=${first.message_id}`;
    const result = await indexBatch(queue, fail("transient"), scope);
    assertEquals(count === 5 ? result.failed : result.retry, 1);
  }
  assertEquals((await state("record", item.id)).reason, "retry_exhausted");
  assertEquals((await admin`select * from pgmq.a_search_index where msg_id=${first.message_id}`).length, 1);
  await change("record", item.id, 1, { summary: "한도 제외" });
  assertEquals((await indexBatch(queue, fail("input_limit"), scope)).excluded, 1);
  assertEquals((await state("record", item.id)).reason, "input_limit");
  await change("record", item.id, 2, { summary: "설정 오류" });
  assertEquals((await indexBatch(queue, fail("configuration"), scope)).failed, 1);
  assertEquals((await state("record", item.id)).reason, "configuration");
  await change("record", item.id, 3, { summary: "새 작업" });
  const current = await state("record", item.id);
  const [forged] = await admin`select pgmq.send('search_index',${
    admin.json({
      owner_id: users.b,
      kind: "record",
      id: item.id,
      input_hash: current.input_hash,
      pipeline: SEARCH_PIPELINE,
    })
  }) as id`;
  assertEquals(await queue.prepare(String(forged.id), SEARCH_PIPELINE), null);
  const [prior] = await admin`select pgmq.send('search_index',${
    admin.json({
      owner_id: users.a,
      kind: "record",
      id: item.id,
      input_hash: current.input_hash,
      pipeline: "old-pipeline",
    })
  }) as id`;
  assertEquals(await queue.prepare(String(prior.id), SEARCH_PIPELINE), null);
  assertEquals((await state("record", item.id)).message_id, current.message_id);
  // 구 서버 메시지를 받는 호환 경로: 현재 원본과 해시는 같지만 상태/파이프라인 필드가 없다.
  await admin`delete from app.search_index_state where id=${item.id}`;
  await admin`update pgmq.q_search_index set message=message-'pipeline' where msg_id=${current.message_id}`;
  assertEquals((await indexBatch(queue, { embed: () => Promise.resolve(vector) }, scope)).indexed, 1);
  for (
    const query of [
      "update app.records set title='침입'",
      "select * from app.records",
      "select * from pgmq.q_search_index",
      "set role app_user",
    ]
  ) {
    assertMatch(await outcome(worker.unsafe(query)), /^42501/);
  }
  assertMatch(await outcome(asUser(user, users.a, (tx) => tx`select app.claim_search_index(1)`)), /^42501/);
  for (const role of ["anon", "authenticated"]) {
    assertMatch(
      await outcome(admin.begin(async (tx) => {
        await tx.unsafe(`set local role ${role}`);
        await tx`select app.claim_search_index(1)`;
      })),
      /^42501/,
    );
  }
  await remove("record", item.id, 4);
});

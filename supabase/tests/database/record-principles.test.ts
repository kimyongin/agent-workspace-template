import { assertEquals, assertRejects } from "@std/assert";
import { SqlUnitOfWork } from "../../functions/_shared/adapters/supabase/activity-store.ts";
import { SqlPrincipleUnitOfWork } from "../../functions/_shared/adapters/supabase/principle-store.ts";
import { recordCreate, recordUpdate } from "../../functions/_shared/contracts/record.ts";
import { principleCreate, principleStatus, principleUpdate } from "../../functions/_shared/contracts/principle.ts";
import { createRecord, getRecord, updateRecord } from "../../functions/_shared/core/activity/application.ts";
import {
  createPrinciple,
  deletePrinciple,
  setPrincipleStatus,
  updatePrinciple,
} from "../../functions/_shared/core/principles/application.ts";
import { AppError } from "../../functions/_shared/core/shared/errors.ts";
import { asUser, connect, dbTest, devUsers, urls } from "./_db.ts";
const admin = connect(urls.admin, { max: 1 }), sql = connect(urls.pooler, { max: 3, prepare: false });
const users = await devUsers(admin), A = { userId: users.a }, B = { userId: users.b };
const deps = { uow: new SqlUnitOfWork(sql), clock: { now: () => new Date() } },
  ps = { uow: new SqlPrincipleUnitOfWork(sql) };
const principle = (actor = A) =>
  createPrinciple(ps, actor, principleCreate.parse({ title: "사용한 원칙", summary: "판단 근거" }));
dbTest("기록 원칙: 생성·현재 상태 조회·연결만 정정·삭제 후 본문과 버전 보존", async () => {
  const p = await principle();
  const r = await createRecord(
    deps,
    A,
    recordCreate.parse({ title: "판단", summary: "결과", body: "당시 판단은 보존", applied_principle_ids: [p.id] }),
  );
  assertEquals(r.applied_principle_ids, [p.id]);
  await updatePrinciple(ps, A, p.id, principleUpdate.parse({ expected_version: 1, title: "현재 원칙" }));
  await setPrincipleStatus(ps, A, p.id, principleStatus.parse({ expected_version: 2, status: "inactive" }));
  const current = await getRecord(deps, A, r.id);
  assertEquals(current.applied_principles[0].title, "현재 원칙");
  assertEquals(current.applied_principles[0].status, "inactive");
  assertEquals(current.applied_principles[0].version, 3);
  const removed = await updateRecord(
    deps,
    A,
    r.id,
    recordUpdate.parse({ expected_version: 1, applied_principle_ids: [] }),
  );
  assertEquals(removed.applied_principle_ids, []);
  const linked = await updateRecord(
    deps,
    A,
    r.id,
    recordUpdate.parse({ expected_version: 2, applied_principle_ids: [p.id] }),
  );
  assertEquals(linked.applied_principle_ids, [p.id]);
  await deletePrinciple(ps, A, p.id, 3);
  const after = await getRecord(deps, A, r.id);
  assertEquals(after.applied_principle_ids, []);
  assertEquals(after.body, "당시 판단은 보존");
  assertEquals(after.version, 4);
  assertEquals((await admin`select msg_id from pgmq.q_search_index where message->>'id'=${r.id}`).length, 1);
});
dbTest("기록 원칙: 다른 소유자·없는 참조 거부와 원본·링크·큐 원자성", async () => {
  const foreign = await principle(B);
  for (const id of [foreign.id, crypto.randomUUID()]) {
    const title = crypto.randomUUID();
    await assertRejects(
      () => createRecord(deps, A, recordCreate.parse({ title, summary: "거부", applied_principle_ids: [id] })),
      AppError,
    );
    assertEquals((await admin`select id from app.records where title=${title}`).length, 0);
  }
  const p = await principle();
  const r = await createRecord(
    deps,
    A,
    recordCreate.parse({ title: "소유자", summary: "격리", applied_principle_ids: [p.id] }),
  );
  assertEquals(
    (await asUser(sql, B.userId, (tx) => tx`select * from app.record_principles where record_id=${r.id}`)).length,
    0,
  );
  await assertRejects(
    () =>
      updateRecord(
        deps,
        A,
        r.id,
        recordUpdate.parse({ expected_version: 1, body: "바뀌면 안 됨", applied_principle_ids: [foreign.id] }),
      ),
    AppError,
  );
  const after = await getRecord(deps, A, r.id);
  assertEquals(after.body, "");
  assertEquals(after.version, 1);
  assertEquals(after.applied_principle_ids, [p.id]);
});

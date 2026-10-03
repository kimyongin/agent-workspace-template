import { assertEquals, assertRejects } from "@std/assert";
import { SqlUnitOfWork } from "../../functions/_shared/adapters/supabase/activity-store.ts";
import { SqlPrincipleUnitOfWork } from "../../functions/_shared/adapters/supabase/principle-store.ts";
import { SqlTagUnitOfWork } from "../../functions/_shared/adapters/supabase/tag-store.ts";
import { recordCreate, recordListQuery, recordUpdate } from "../../functions/_shared/contracts/record.ts";
import { principleCreate, principleListQuery, principleUpdate } from "../../functions/_shared/contracts/principle.ts";
import { tagCreate } from "../../functions/_shared/contracts/tag.ts";
import {
  createRecord,
  getRecord,
  listRecords,
  updateRecord,
} from "../../functions/_shared/core/activity/application.ts";
import {
  createPrinciple,
  getPrinciple,
  listPrinciples,
  updatePrinciple,
} from "../../functions/_shared/core/principles/application.ts";
import { createTag, deleteTag } from "../../functions/_shared/core/tags/application.ts";
import { AppError } from "../../functions/_shared/core/shared/errors.ts";
import { connect, dbTest, devUsers, urls } from "./_db.ts";
const admin = connect(urls.admin, { max: 1 }),
  sql = connect(urls.pooler, { max: 3, prepare: false }),
  users = await devUsers(admin);
const A = { userId: users.a }, B = { userId: users.b };
const deps = { uow: new SqlUnitOfWork(sql), clock: { now: () => new Date() } },
  ps = { uow: new SqlPrincipleUnitOfWork(sql) },
  tags = { uow: new SqlTagUnitOfWork(sql) };
dbTest("기록·원칙 태그: 원자성·소유자·필터·정정·태그 삭제 후 본문 보존", async () => {
  const t = await createTag(tags, A, tagCreate.parse({ name: crypto.randomUUID().slice(0, 30) }));
  const foreign = await createTag(tags, B, tagCreate.parse({ name: crypto.randomUUID().slice(0, 30) }));
  for (const tagId of [foreign.id, crypto.randomUUID()]) {
    await assertRejects(
      () => createRecord(deps, A, recordCreate.parse({ title: "거부", summary: "격리", tag_ids: [tagId] })),
      AppError,
    );
    await assertRejects(
      () => createPrinciple(ps, A, principleCreate.parse({ title: "거부", summary: "격리", tag_ids: [tagId] })),
      AppError,
    );
  }
  const r = await createRecord(
    deps,
    A,
    recordCreate.parse({ title: "기록", summary: "요약", body: "본문", tag_ids: [t.id] }),
  );
  const p = await createPrinciple(
    ps,
    A,
    principleCreate.parse({ title: "원칙", summary: "요약", body: "근거", tag_ids: [t.id] }),
  );
  assertEquals((await listRecords(deps, A, recordListQuery.parse({ tag_id: t.id }))).items.map((x) => x.id), [r.id]);
  assertEquals((await listPrinciples(ps, A, principleListQuery.parse({ tag_id: t.id }))).items.map((x) => x.id), [
    p.id,
  ]);
  await assertRejects(
    () => updateRecord(deps, A, r.id, recordUpdate.parse({ expected_version: 1, body: "실패", tag_ids: [foreign.id] })),
    AppError,
  );
  await assertRejects(
    () =>
      updatePrinciple(ps, A, p.id, principleUpdate.parse({ expected_version: 1, body: "실패", tag_ids: [foreign.id] })),
    AppError,
  );
  assertEquals((await getRecord(deps, A, r.id)).version, 1);
  assertEquals((await getPrinciple(ps, A, p.id)).version, 1);
  await updateRecord(deps, A, r.id, recordUpdate.parse({ expected_version: 1, tag_ids: [] }));
  await updateRecord(deps, A, r.id, recordUpdate.parse({ expected_version: 2, tag_ids: [t.id] }));
  await updatePrinciple(ps, A, p.id, principleUpdate.parse({ expected_version: 1, tag_ids: [] }));
  await updatePrinciple(ps, A, p.id, principleUpdate.parse({ expected_version: 2, tag_ids: [t.id] }));
  await deleteTag(tags, A, t.id, 1);
  const afterR = await getRecord(deps, A, r.id), afterP = await getPrinciple(ps, A, p.id);
  assertEquals(afterR.tag_ids, []);
  assertEquals(afterP.tag_ids, []);
  assertEquals(afterR.body, "본문");
  assertEquals(afterP.body, "근거");
  assertEquals(afterR.version, 4);
  assertEquals(afterP.version, 4);
  assertEquals(
    (await admin`select msg_id from pgmq.q_search_index where message->>'id' in (${r.id},${p.id})`).length,
    2,
  );
});

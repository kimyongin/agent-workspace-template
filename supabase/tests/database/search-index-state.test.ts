import { assertEquals, assertMatch, assertRejects } from "@std/assert";
import { SqlUnitOfWork } from "../../functions/_shared/adapters/supabase/activity-store.ts";
import { recordCreate, recordUpdate } from "../../functions/_shared/contracts/record.ts";
import * as activity from "../../functions/_shared/core/activity/application.ts";
import { SEARCH_PIPELINE } from "../../functions/_shared/core/search/config.ts";
import { searchInputHash } from "../../functions/_shared/core/shared/operations.ts";
import { asUser, connect, dbTest, fixtureOwner, outcome, urls } from "./_db.ts";
const admin = connect(urls.admin, { max: 1 }), sql = connect(urls.pooler, { max: 3, prepare: false });
const fixture = await fixtureOwner(admin), foreign = await fixtureOwner(admin), A = fixture.actor;
const deps = { uow: new SqlUnitOfWork(sql), clock: { now: () => new Date() } };
dbTest("record body hash: one current logical queue job, owner isolation and missing-message recovery", async () => {
  const item = await activity.createRecord(
    deps,
    A,
    recordCreate.parse({ id: crypto.randomUUID(), body: "검색 원문😀" }),
  );
  const hash = await searchInputHash(item.body);
  const state = async () => (await admin`select * from app.search_index_state where id=${item.id}`)[0];
  const messages = () =>
    admin`select msg_id from pgmq.q_search_index where message->>'owner_id'=${A.userId} and message->>'id'=${item.id}`;
  const enqueue = (actor = A, value = hash) =>
    asUser(
      sql,
      actor.userId,
      (tx) => tx`select app.enqueue_search_index('record',${item.id},${value},${SEARCH_PIPELINE})`,
    );
  const first = await state();
  assertEquals(first.input_hash, hash);
  await Promise.all([enqueue(), enqueue(), enqueue()]);
  assertEquals((await messages()).length, 1);
  assertEquals((await state()).message_id, first.message_id);
  await assertRejects(() => enqueue(foreign.actor));
  await assertRejects(() => enqueue(A, "f".repeat(64)));
  assertEquals(
    (await asUser(sql, foreign.actor.userId, (tx) => tx`select * from app.search_index_state where id=${item.id}`))
      .length,
    0,
  );
  assertMatch(
    await outcome(
      asUser(sql, A.userId, (tx) => tx`update app.search_index_state set state='indexed' where id=${item.id}`),
    ),
    /^42501/,
  );
  await admin`delete from pgmq.q_search_index where msg_id=${first.message_id}`;
  await enqueue();
  assertEquals((await messages()).length, 1);
  const changed = await activity.updateRecord(
    deps,
    A,
    item.id,
    recordUpdate.parse({ expected_version: 1, body: "바뀐 원문😀" }),
  );
  assertEquals((await state()).input_hash, await searchInputHash(changed.body));
  assertEquals((await state()).state, "pending");
  assertEquals((await messages()).length, 1);
  await assertRejects(() =>
    asUser(sql, A.userId, (tx) => tx`select app.enqueue_search_index('task',${item.id},${hash},${SEARCH_PIPELINE})`)
  );
  await activity.deleteRecord(deps, A, item.id, 2);
  assertEquals(await state(), undefined);
  assertEquals((await messages()).length, 0);
});
dbTest("search-index-state fixture cleanup", async () => {
  await fixture.cleanup();
  await foreign.cleanup();
});

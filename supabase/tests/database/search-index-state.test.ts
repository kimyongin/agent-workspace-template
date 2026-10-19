import { taskCreate } from "../../functions/_shared/contracts/task.ts";
import { businessRequest, businessWorkspaceFixture } from "./_workspace-business.ts";
import { runInWorkspace } from "../../functions/_shared/adapters/supabase/workspace-context.ts";
import { assertEquals, assertMatch, assertRejects } from "@std/assert";
import { SqlUnitOfWork } from "../../functions/_shared/adapters/supabase/activity-store.ts";
import { recordUpdate } from "../../functions/_shared/contracts/record.ts";
import * as activity from "../../functions/_shared/core/activity/application.ts";
import { SEARCH_PIPELINE } from "../../functions/_shared/core/search/config.ts";
import { searchInputHash } from "../../functions/_shared/core/shared/operations.ts";
import { asUser, connect, dbTest, outcome, urls } from "./_db.ts";
const admin = connect(urls.admin, { max: 1 }), sql = connect(urls.pooler, { max: 3, prepare: false });
const fixture = await businessWorkspaceFixture(admin, sql);
await fixture.grant(fixture.member, [{ target_kind: "tasks", target_id: "*", access: "write" }]);
const A = fixture.member;
const otherWorkspace = await fixture.addWorkspace("격리된 검색 검증");
await fixture.grant(otherWorkspace.member, [{ target_kind: "tasks", target_id: "*", access: "write" }]);
const foreign = { actor: otherWorkspace.member };
const deps = { uow: new SqlUnitOfWork(sql), clock: { now: () => new Date() } };
dbTest(
  "record body hash: one current logical queue job, workspace isolation and missing-message recovery",
  async () => {
    const task = await activity.createTask(
      deps,
      businessRequest(A),
      taskCreate.parse({ kind: "once", title: "검색 상태 결과" }),
    );
    const { record: item } = await activity.completeTask(deps, businessRequest(A), task.id, {
      expected_version: task.version,
      body: "검색 원문😀",
    });
    const hash = await searchInputHash(item.body);
    const state = async () =>
      (await admin`select * from app.search_index_state where workspace_id=${A.workspaceId} and kind='record' and id=${item.id}`)[
        0
      ];
    const messages = () =>
      admin`select msg_id from pgmq.q_search_index where message->>'workspace_id'=${A.workspaceId} and message->>'id'=${item.id}`;
    const enqueue = (actor = A, value = hash) =>
      runInWorkspace(
        sql,
        actor,
        { mode: "business", requirements: [{ target_kind: "tasks", target_id: "*", access: "write" }] },
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
      (await runInWorkspace(
        sql,
        foreign.actor,
        { mode: "business", requirements: [] },
        (tx) =>
          tx`select * from app.search_index_state where workspace_id=${A.workspaceId} and kind='record' and id=${item.id}`,
      ))
        .length,
      0,
    );
    assertMatch(
      await outcome(
        asUser(
          sql,
          A.userId,
          (tx) =>
            tx`update app.search_index_state set state='indexed' where workspace_id=${A.workspaceId} and kind='record' and id=${item.id}`,
        ),
      ),
      /^42501/,
    );
    await admin`delete from pgmq.q_search_index where msg_id=${first.message_id}`;
    await enqueue();
    assertEquals((await messages()).length, 1);
    const changed = await activity.updateRecord(
      deps,
      businessRequest(A),
      item.id,
      recordUpdate.parse({ expected_version: 1, body: "바뀐 원문😀" }),
    );
    assertEquals((await state()).input_hash, await searchInputHash(changed.body));
    assertEquals((await state()).state, "pending");
    assertEquals((await messages()).length, 1);
    await assertRejects(() =>
      runInWorkspace(sql, A, {
        mode: "business",
        requirements: [{ target_kind: "tasks", target_id: "*", access: "write" }],
      }, (tx) => tx`select app.enqueue_search_index('task',${item.id},${hash},${SEARCH_PIPELINE})`)
    );
    await activity.deleteRecord(deps, businessRequest(A), item.id, 2);
    assertEquals(await state(), undefined);
    assertEquals((await messages()).length, 0);
  },
);
dbTest("search-index-state fixture cleanup", async () => {
  await fixture.cleanup();
});

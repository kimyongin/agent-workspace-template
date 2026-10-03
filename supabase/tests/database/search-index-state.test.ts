import { assertEquals, assertMatch, assertRejects } from "@std/assert";
import { SqlUnitOfWork } from "../../functions/_shared/adapters/supabase/activity-store.ts";
import { SqlPrincipleUnitOfWork } from "../../functions/_shared/adapters/supabase/principle-store.ts";
import { SqlSearchUnitOfWork } from "../../functions/_shared/adapters/supabase/search-store.ts";
import { taskCreate, taskUpdate } from "../../functions/_shared/contracts/task.ts";
import { recordCreate, recordUpdate } from "../../functions/_shared/contracts/record.ts";
import { principleCreate, principleUpdate } from "../../functions/_shared/contracts/principle.ts";
import { searchInput } from "../../functions/_shared/contracts/search.ts";
import * as activity from "../../functions/_shared/core/activity/application.ts";
import * as principles from "../../functions/_shared/core/principles/application.ts";
import { search } from "../../functions/_shared/core/search/application.ts";
import { SEARCH_PIPELINE } from "../../functions/_shared/core/search/config.ts";
import { searchInputHash } from "../../functions/_shared/core/shared/operations.ts";
import { asUser, connect, dbTest, devUsers, outcome, urls } from "./_db.ts";
const admin = connect(urls.admin, { max: 1 }),
  sql = connect(urls.pooler, { max: 3, prepare: false }),
  users = await devUsers(admin);
const A = { userId: users.a },
  d = { uow: new SqlUnitOfWork(sql), clock: { now: () => new Date() } },
  p = { uow: new SqlPrincipleUnitOfWork(sql) },
  s = { uow: new SqlSearchUnitOfWork(sql) };
dbTest("색인 상태: 3종류 최신 작업 하나·중복/실패 복구·본문 억제·삭제 정리·RLS", async () => {
  for (const kind of ["task", "record", "principle"] as const) {
    const tag = crypto.randomUUID();
    await asUser(sql, users.a, async (tx) => {
      await tx`insert into app.tags(id,owner_id,name) values(${tag},${users.a},${tag.slice(0, 30)})`;
    });
    const input = { title: crypto.randomUUID(), summary: "검색 입력", body: "원문", tag_ids: [tag] };
    const item = kind === "task"
      ? await activity.createTask(d, A, taskCreate.parse({ ...input, kind: "once" }))
      : kind === "record"
      ? await activity.createRecord(d, A, recordCreate.parse(input))
      : await principles.createPrinciple(p, A, principleCreate.parse(input));
    const hash = await searchInputHash(item);
    const enqueue = (actor = A, value = hash) =>
      asUser(sql, actor.userId, async (tx) => {
        await tx`select app.enqueue_search_index(${kind},${item.id},${value},${SEARCH_PIPELINE})`;
      });
    const state = async () =>
      (await admin`select * from app.search_index_state where owner_id=${users.a} and kind=${kind} and id=${item.id}`)[
        0
      ];
    const messages = () =>
      admin`select msg_id,message from pgmq.q_search_index where message->>'owner_id'=${users.a} and message->>'kind'=${kind} and message->>'id'=${item.id}`;
    const first = await state();
    assertEquals(first.input_hash, hash);
    assertEquals(first.pipeline, SEARCH_PIPELINE);
    await Promise.all([enqueue(), enqueue(), enqueue()]);
    assertEquals((await messages()).length, 1);
    assertEquals((await state()).message_id, first.message_id);
    await assertRejects(() => enqueue({ userId: users.b }));
    await assertRejects(() => enqueue(A, "f".repeat(64)));
    assertEquals(
      (await asUser(sql, users.b, (tx) => tx`select * from app.search_index_state where id=${item.id}`)).length,
      0,
    );
    assertMatch(
      await outcome(asUser(sql, users.a, async (tx) => {
        await tx`update app.search_index_state set state='indexed' where id=${item.id}`;
      })),
      /^42501/,
    );
    await admin`delete from pgmq.q_search_index where msg_id=${first.message_id}`;
    await enqueue();
    assertEquals((await messages()).length, 1);
    const query = searchInput.parse({ query: input.title, kinds: [kind], mode: "keyword", tag_id: tag });
    await admin`update app.search_index_state set state='indexed',message_id=null where kind=${kind} and id=${item.id}`;
    assertEquals((await search(s, A, query)).items[0].index_state, "indexed");
    assertEquals((await search(s, A, query)).semantic_coverage, { pending: 0, excluded: 0 });
    await admin`update app.search_index_state set state='excluded',reason='input_limit' where kind=${kind} and id=${item.id}`;
    assertEquals((await search(s, A, query)).items[0].index_state, "excluded");
    assertEquals((await search(s, A, query)).semantic_coverage, { pending: 0, excluded: 1 });
    await admin`update app.search_index_state set pipeline='previous-pipeline' where kind=${kind} and id=${item.id}`;
    assertEquals((await search(s, A, query)).items[0].index_state, "pending");
    assertEquals((await search(s, A, query)).semantic_coverage, { pending: 1, excluded: 0 });
    const changed = kind === "task"
      ? await activity.updateTask(d, A, item.id, taskUpdate.parse({ expected_version: 1, title: "새 " + input.title }))
      : kind === "record"
      ? await activity.updateRecord(
        d,
        A,
        item.id,
        recordUpdate.parse({ expected_version: 1, title: "새 " + input.title }),
      )
      : await principles.updatePrinciple(
        p,
        A,
        item.id,
        principleUpdate.parse({ expected_version: 1, title: "새 " + input.title }),
      );
    assertEquals((await messages()).length, 1);
    assertEquals((await state()).input_hash, await searchInputHash(changed));
    assertEquals((await state()).state, "pending");
    const latest = (await state()).message_id;
    if (kind === "task") {
      await activity.updateTask(d, A, item.id, taskUpdate.parse({ expected_version: 2, body: "수정 원문" }));
    } else if (kind === "record") {
      await activity.updateRecord(d, A, item.id, recordUpdate.parse({ expected_version: 2, body: "수정 원문" }));
    } else {await principles.updatePrinciple(
        p,
        A,
        item.id,
        principleUpdate.parse({ expected_version: 2, body: "수정 원문" }),
      );}
    assertEquals((await state()).message_id, latest);
    if (kind === "task") await activity.deleteTask(d, A, item.id, 3);
    else if (kind === "record") await activity.deleteRecord(d, A, item.id, 3);
    else await principles.deletePrinciple(p, A, item.id, 3);
    assertEquals(await state(), undefined);
    assertEquals((await messages()).length, 0);
  }
  for (const role of ["authenticated", "anon"]) {
    assertMatch(
      await outcome(admin.begin(async (tx) => {
        await tx.unsafe(`set local role ${role}`);
        await tx`select app.enqueue_search_index('task',${crypto.randomUUID()},${"f".repeat(64)},${SEARCH_PIPELINE})`;
      })),
      /^42501/,
    );
  }
});

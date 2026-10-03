import { assert, assertEquals, assertMatch, assertRejects } from "@std/assert";
import { SqlPrincipleUnitOfWork } from "../../functions/_shared/adapters/supabase/principle-store.ts";
import { principleCreate, principleListQuery } from "../../functions/_shared/contracts/principle.ts";
import { createPrinciple, getPrinciple, listPrinciples } from "../../functions/_shared/core/principles/application.ts";
import { asUser, connect, dbTest, devUsers, outcome, urls } from "./_db.ts";

const admin = connect(urls.admin, { max: 1 });
const sql = connect(urls.pooler, { max: 2, prepare: false });
const users = await devUsers(admin);
const A = { userId: users.a }, B = { userId: users.b };
const deps = { uow: new SqlPrincipleUnitOfWork(sql) };
const input = (extra = {}) => principleCreate.parse({ title: "휴가 독서", summary: "긴 책은 휴가에 읽음", ...extra });

dbTest("원칙: 생성·큐·동시 멱등성·다른 요청 내용의 충돌", async () => {
  const request = input({ request_id: crypto.randomUUID() });
  const [p, retry] = await Promise.all([createPrinciple(deps, A, request), createPrinciple(deps, A, request)]);
  assertEquals(p.id, retry.id);
  assertEquals(p.status, "active");
  const messages = await admin`select message from pgmq.q_search_index where message->>'id' = ${p.id}`;
  assertEquals(messages.length, 1);
  assertEquals(messages[0].message.kind, "principle");
  assertEquals(messages[0].message.owner_id, A.userId);
  await assertRejects(() => createPrinciple(deps, A, { ...request, title: "다른 내용" }));
});

dbTest("원칙: RLS·직접 쓰기 거부·상태 필터·소유자/필터 커서 격리", async () => {
  const p = await createPrinciple(deps, A, input());
  await createPrinciple(deps, A, input());
  await assertRejects(() => getPrinciple(deps, B, p.id));
  const hidden = await asUser(sql, B.userId, (tx) => tx`select id from app.principles where id = ${p.id}`);
  assertEquals(hidden.length, 0);
  const denied = await outcome(admin.begin(async (tx) => {
    await tx`set local role authenticated`;
    await tx`insert into app.principles (owner_id, title, summary) values (${A.userId}, '우회', '우회')`;
  }));
  assertMatch(denied, /^42501 permission denied for (schema app|table principles)/);
  const page = await listPrinciples(deps, A, principleListQuery.parse({ limit: 1 }));
  assert(page.next_cursor);
  const next = await listPrinciples(deps, A, principleListQuery.parse({ limit: 1, cursor: page.next_cursor }));
  assert(next.items[0].id !== page.items[0].id);
  await assertRejects(() => listPrinciples(deps, B, principleListQuery.parse({ cursor: page.next_cursor })));
  await assertRejects(() =>
    listPrinciples(deps, A, principleListQuery.parse({ status: "inactive", cursor: page.next_cursor }))
  );
  await admin`update app.principles set status = 'inactive' where id = ${p.id}`;
  const inactive = await listPrinciples(deps, A, principleListQuery.parse({ status: "inactive", limit: 100 }));
  assert(inactive.items.some((r) => r.id === p.id));
  assertEquals((await getPrinciple(deps, A, p.id)).status, "inactive");
});

dbTest("원칙: 큐 등록 후 실패는 원본·큐·요청 결과를 함께 롤백", async () => {
  const title = `원자성-${crypto.randomUUID()}`;
  const request = input({ title, request_id: crypto.randomUUID() });
  let insertedId = "";
  await assertRejects(() =>
    deps.uow.run(A, async (store) => {
      const p = await store.insert(request);
      insertedId = p.id;
      await store.enqueueIndex({ kind: "principle", id: p.id, input_hash: "f".repeat(64) });
      await store.saveRequest("create_principle", request.request_id!, "f".repeat(64), p);
      throw new Error("큐 전송 뒤 실패");
    })
  );
  assertEquals((await admin`select id from app.principles where title = ${title}`).length, 0);
  assertEquals((await admin`select msg_id from pgmq.q_search_index where message->>'id' = ${insertedId}`).length, 0);
  assertEquals(
    (await admin`select request_id from app.request_results where request_id = ${request.request_id!}`).length,
    0,
  );
});

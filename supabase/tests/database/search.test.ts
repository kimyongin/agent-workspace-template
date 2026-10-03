import { assert, assertEquals, assertRejects } from "@std/assert";
import { SqlSearchUnitOfWork } from "../../functions/_shared/adapters/supabase/search-store.ts";
import { searchInput, searchResult } from "../../functions/_shared/contracts/search.ts";
import { search } from "../../functions/_shared/core/search/application.ts";
import { AppError } from "../../functions/_shared/core/shared/errors.ts";
import { asUser, connect, dbTest, devUsers, urls } from "./_db.ts";
const admin = connect(urls.admin, { max: 1 }),
  sql = connect(urls.pooler, { max: 3, prepare: false }),
  users = await devUsers(admin);
const d = { uow: new SqlSearchUnitOfWork(sql) }, A = { userId: users.a }, B = { userId: users.b };
dbTest("검색: 한국어 본문·literal 와일드카드·상태·태그·기간·개수 격리와 복합 커서", async () => {
  const token = crypto.randomUUID(),
    sameId = crypto.randomUUID(),
    tagId = crypto.randomUUID(),
    scopeTag = crypto.randomUUID(),
    at = "2001-03-04T00:00:00.000Z";
  await asUser(sql, users.a, async (tx) => {
    await tx`insert into app.tags(id,owner_id,name) values(${tagId},${users.a},${token.slice(0, 30)})`;
    await tx`insert into app.tags(id,owner_id,name) values(${scopeTag},${users.a},${scopeTag.slice(0, 30)})`;
    await tx`insert into app.tasks(id,owner_id,kind,status,title,summary,body,updated_at) values(${sameId},${users.a},'once','open','업무','제목 외',${
      token + " 재활용 %_"
    },${at})`;
    await tx`insert into app.records(id,owner_id,title,summary,body,occurred_at) values(${sameId},${users.a},'기록','근거',${
      token + " 재활용 %_"
    },${at})`;
    await tx`insert into app.principles(id,owner_id,title,summary,body,updated_at) values(${sameId},${users.a},'원칙','규칙',${
      token + " 재활용 %_"
    },${at})`;
    await tx`insert into app.record_tags(owner_id,record_id,tag_id) values(${users.a},${sameId},${tagId})`;
    await tx`insert into app.task_tags(owner_id,task_id,tag_id) values(${users.a},${sameId},${scopeTag})`;
    await tx`insert into app.record_tags(owner_id,record_id,tag_id) values(${users.a},${sameId},${scopeTag})`;
    await tx`insert into app.principle_tags(owner_id,principle_id,tag_id) values(${users.a},${sameId},${scopeTag})`;
    await tx`insert into app.principles(owner_id,title,summary,body,status) values(${users.a},'과거','비활성',${token},'inactive')`;
  });
  await asUser(sql, users.b, async (tx) => {
    await tx`insert into app.records(owner_id,title,summary,body) values(${users.b},'비밀','보호',${token})`;
  });
  const base = searchInput.parse({ query: token, mode: "keyword", limit: 1, tag_id: scopeTag, from: at, to: at }),
    first = searchResult.parse(await search(d, A, base));
  assertEquals(first.semantic_coverage, { pending: 3, excluded: 0 });
  assertEquals(first.items[0].kind, "task");
  assert(first.next_cursor);
  const second = await search(d, A, { ...base, cursor: first.next_cursor });
  assertEquals(second.items[0].kind, "record");
  assert(second.next_cursor);
  const third = await search(d, A, { ...base, cursor: second.next_cursor });
  assertEquals(third.items[0].kind, "principle");
  assertEquals(third.next_cursor, null);
  assertEquals("body" in first.items[0], false);
  for (
    const change of [{ query: token + "changed" }, { mode: "auto" as const }, { tag_id: tagId }, {
      status: "all" as const,
    }]
  ) await assertRejects(() => search(d, A, { ...base, ...change, cursor: first.next_cursor! }), AppError);
  await assertRejects(() => search(d, B, { ...base, cursor: first.next_cursor! }), AppError);
  const only = await search(d, A, searchInput.parse({ query: "%_", tag_id: tagId, from: at, to: at }));
  assertEquals(only.items.map((x) => x.kind), ["record"]);
  assertEquals(only.search_state, "keyword_fallback");
  assertEquals(only.semantic_coverage.pending, 1);
  const none = await search(d, A, searchInput.parse({ query: "없는 말", tag_id: tagId }));
  assertEquals(none.items, []);
  assertEquals(none.semantic_coverage.pending, 1);
  const foreign = await search(d, B, searchInput.parse({ query: token, tag_id: tagId }));
  assertEquals(foreign.semantic_coverage.pending, 0);
  assertEquals(foreign.items, []);
  assertEquals((await search(d, A, searchInput.parse({ query: token, status: "all" }))).items.length, 4);
  assertEquals(
    (await search(d, A, searchInput.parse({ query: token, status: "inactive" }))).items.map((x) => x.kind).sort(),
    ["principle", "record", "task"],
  );
  assertEquals(
    (await search(d, A, searchInput.parse({ query: token, kinds: ["record"], from: "2026-10-04T00:00:00Z" }))).items,
    [],
  );
});

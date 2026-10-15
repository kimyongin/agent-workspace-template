import { assert, assertEquals, assertRejects } from "@std/assert";
import { SqlSearchUnitOfWork } from "../../functions/_shared/adapters/supabase/search-store.ts";
import { searchInput, searchResult } from "../../functions/_shared/contracts/search.ts";
import { search } from "../../functions/_shared/core/search/application.ts";
import { AppError } from "../../functions/_shared/core/shared/errors.ts";
import { asUser, connect, dbTest, fixtureOwner, urls } from "./_db.ts";
import { entityFixture } from "./_entity.ts";
const admin = connect(urls.admin, { max: 1 }),
  sql = connect(urls.pooler, { max: 3, prepare: false }),
  fixture = await fixtureOwner(admin),
  foreignFixture = await fixtureOwner(admin),
  users = { a: fixture.actor.userId, b: foreignFixture.actor.userId };
const d = { uow: new SqlSearchUnitOfWork(sql) }, A = { userId: users.a }, B = { userId: users.b };
dbTest("검색: 한국어 본문·literal 와일드카드·상태·태그·기간·개수 격리와 복합 커서", async () => {
  const schema = await entityFixture(admin, users.a);
  const token = crypto.randomUUID(),
    sameId = crypto.randomUUID(),
    tagId = crypto.randomUUID(),
    externalId = crypto.randomUUID(),
    entity = `app:${schema.entity_type_id}:${externalId}`,
    scopeTag = crypto.randomUUID(),
    taskTag = crypto.randomUUID(),
    at = "2001-03-04T00:00:00.000Z";
  await asUser(sql, users.a, async (tx) => {
    await tx`insert into app.entities(id,owner_id,source,external_id,entity_type_id,schema_version,properties)
      values(${entity},${users.a},'app',${externalId},${schema.entity_type_id},${schema.schema_version},'{"prop_1":"검색 범위"}'::jsonb)`;
    await tx`insert into app.tags(id,owner_id,name) values(${tagId},${users.a},${token.slice(0, 30)})`;
    await tx`insert into app.tags(id,owner_id,name) values(${scopeTag},${users.a},${scopeTag.slice(0, 30)})`;
    await tx`insert into app.tags(id,owner_id,name,scope) values(${taskTag},${users.a},${taskTag.slice(0, 30)},'task')`;
    await tx`insert into app.tasks(id,owner_id,kind,status,title,body,updated_at) values(${sameId},${users.a},'once','open','업무',${
      token + " 재활용 %_"
    },${at})`;
    await tx`insert into app.records(id,owner_id,body,occurred_at) values(${sameId},${users.a},${
      token + " 재활용 %_"
    },${at})`;
    await tx`insert into app.principles(id,owner_id,title,body,updated_at,saved_at,is_current) values(${sameId},${users.a},'원칙',${
      token + " 재활용 %_"
    },${at},${at},true)`;
    await tx`insert into app.record_tags(owner_id,record_id,tag_id) values(${users.a},${sameId},${tagId})`;
    await tx`insert into app.task_tags(owner_id,task_id,tag_id) values(${users.a},${sameId},${taskTag})`;
    await tx`insert into app.record_tags(owner_id,record_id,tag_id) values(${users.a},${sameId},${scopeTag})`;
    await tx`update app.tasks set entity_ids=array[${entity}::text] where id=${sameId}`;
    await tx`update app.records set entity_ids=array[${entity}::text] where id=${sameId}`;
  });
  await asUser(sql, users.b, async (tx) => {
    await tx`insert into app.records(owner_id,body) values(${users.b},${token})`;
  });
  const base = searchInput.parse({
      query: token,
      mode: "keyword",
      limit: 1,
      tag_ids: [scopeTag, taskTag],
      entity_id: entity,
      from: at,
      to: at,
    }),
    first = searchResult.parse(await search(d, A, base));
  assertEquals(first.semantic_coverage, { pending: 1, excluded: 0 });
  assertEquals(first.items[0].kind, "task");
  assertEquals((await search(d, A, { ...base, anchor: { kind: "principle", id: sameId } })).anchor_page, null);
  assertEquals((await search(d, B, { ...base, anchor: { kind: "principle", id: sameId } })).anchor_page, null);
  assertEquals(
    (await search(d, A, { ...base, query: "없는 말", anchor: { kind: "principle", id: sameId } })).anchor_page,
    null,
  );
  assert(first.next_cursor);
  const second = await search(d, A, { ...base, cursor: first.next_cursor });
  assertEquals(second.items[0].kind, "record");
  assertEquals(second.next_cursor, null);
  const multi = searchInput.parse({ query: token, mode: "keyword", tag_ids: [tagId, scopeTag, taskTag], limit: 1 });
  const multiFirst = await search(d, A, multi);
  assertEquals(multiFirst.items[0].kind, "task");
  assertEquals((await search(d, A, { ...multi, cursor: multiFirst.next_cursor! })).items[0].kind, "record");
  assertEquals((await search(d, B, multi)).items, []);
  await assertRejects(() => search(d, A, { ...multi, tag_ids: [tagId], cursor: multiFirst.next_cursor! }), AppError);
  assertEquals("body" in first.items[0], false);
  for (
    const change of [
      { query: token + "changed" },
      { mode: "auto" as const },
      { tag_id: tagId },
      { entity_id: `app:00000000-0000-4000-8000-000000000001:${crypto.randomUUID()}` },
      { entity_id: undefined },
      { kinds: ["record"] as ("record")[] },
    ]
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
  assertEquals((await search(d, A, searchInput.parse({ query: token }))).items.length, 3);
  assertEquals(
    (await search(d, A, searchInput.parse({ query: token, kinds: ["record"], from: "2026-10-04T00:00:00Z" }))).items,
    [],
  );
  assertEquals(
    (await search(d, A, searchInput.parse({ query: token, entity_id: entity }))).items.length,
    2,
  );
  const noMatch = await search(d, A, searchInput.parse({ query: "없는 말", entity_id: entity }));
  assertEquals(noMatch.semantic_coverage, { pending: 1, excluded: 0 });
  const foreignEntity = await search(d, B, searchInput.parse({ query: token, entity_id: entity }));
  assertEquals(foreignEntity.items, []);
  assertEquals(foreignEntity.semantic_coverage, { pending: 0, excluded: 0 });
});

dbTest("search fixture cleanup", async () => {
  await fixture.cleanup();
  await foreignFixture.cleanup();
});

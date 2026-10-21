import { assert, assertEquals, assertRejects } from "@std/assert";
import { SqlSearchUnitOfWork } from "../../functions/_shared/adapters/supabase/search-store.ts";
import { searchInput, searchResult } from "../../functions/_shared/contracts/search.ts";
import { search } from "../../functions/_shared/core/search/application.ts";
import { AppError } from "../../functions/_shared/core/shared/errors.ts";
import { SqlUnitOfWork } from "../../functions/_shared/adapters/supabase/activity-store.ts";
import { SqlEntityUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-store.ts";
import { SqlTagUnitOfWork } from "../../functions/_shared/adapters/supabase/tag-store.ts";
import { entityCreate } from "../../functions/_shared/contracts/entity.ts";
import { taskCreate } from "../../functions/_shared/contracts/task.ts";
import * as activity from "../../functions/_shared/core/activity/application.ts";
import * as entities from "../../functions/_shared/core/entity/application.ts";
import * as tags from "../../functions/_shared/core/tags/application.ts";
import { connect, dbTest, urls } from "./_db.ts";
import { businessRequest, businessWorkspaceFixture } from "./_workspace-business.ts";
const admin = connect(urls.admin, { max: 1 }), sql = connect(urls.pooler, { max: 3, prepare: false });
const fixture = await businessWorkspaceFixture(admin, sql);
await fixture.grant(fixture.member, [{ target_kind: "tasks", target_id: "*", access: "write" }]);
const foreign = await fixture.addWorkspace("검색 공간 격리");
await fixture.grant(foreign.member, [{ target_kind: "tasks", target_id: "*", access: "write" }]);
const d = { uow: new SqlSearchUnitOfWork(sql) }, A = fixture.member, B = foreign.member;
const activityDeps = { uow: new SqlUnitOfWork(sql), clock: { now: () => new Date() } };
const tagDeps = { uow: new SqlTagUnitOfWork(sql) };
dbTest("검색: 한국어 본문·literal 와일드카드·상태·태그·기간·개수 격리와 복합 커서", async () => {
  const kind = await fixture.createKind("검색 범위");
  await fixture.grantKind(A, kind.id, "write");
  const entity = (await entities.createEntity(
    { uow: new SqlEntityUnitOfWork(sql) },
    businessRequest(A),
    entityCreate.parse({
      entity_type_id: kind.id,
      schema_version: 1,
      properties: { prop_1: "검색 범위" },
    }),
  )).id;
  const token = crypto.randomUUID(), at = "2001-03-04T00:00:00.000Z";
  const tagId = (await tags.createTag(tagDeps, businessRequest(A), { scope: "record", name: token.slice(0, 30) })).id;
  const scopeTag = (await tags.createTag(tagDeps, businessRequest(A), { scope: "record", name: "기록 검색 범위" })).id;
  const taskTag = (await tags.createTag(tagDeps, businessRequest(A), { scope: "task", name: "할 일 검색 범위" })).id;
  const task = await activity.createTask(
    activityDeps,
    businessRequest(A),
    taskCreate.parse({
      kind: "once",
      title: "업무",
      body: token + " 재활용 %_",
      entity_ids: [entity],
    }),
  );
  const completed = await activity.completeTask(activityDeps, businessRequest(A), task.id, {
    expected_version: task.version,
    body: token + " 재활용 %_",
    occurred_at: at,
  });
  await tags.setTagConnections(tagDeps, businessRequest(A), {
    target_kind: "record",
    target_id: completed.record.id,
    expected_version: completed.record.version,
    tag_ids: [tagId, scopeTag],
  });
  await tags.setTagConnections(tagDeps, businessRequest(A), {
    target_kind: "task",
    target_id: task.id,
    expected_version: completed.task.version,
    tag_ids: [taskTag],
  });
  const foreignTask = await activity.createTask(
    activityDeps,
    businessRequest(B),
    taskCreate.parse({ kind: "once", title: "다른 공간" }),
  );
  await activity.completeTask(activityDeps, businessRequest(B), foreignTask.id, {
    expected_version: foreignTask.version,
    body: token,
  });
  const base = searchInput.parse({
      query: token,
      mode: "keyword",
      limit: 1,
      tag_ids: [scopeTag, taskTag],
      from: at,
      to: "2099-01-01T00:00:00Z",
    }),
    first = searchResult.parse(await search(d, A, base));
  assertEquals(first.semantic_coverage, { pending: 1, excluded: 0, failed: 0 });
  assertEquals(first.items[0].kind, "task");
  assertEquals(
    (await search(d, A, { ...base, anchor: { kind: "record", id: crypto.randomUUID() } })).anchor_page,
    null,
  );
  assertEquals(
    (await search(d, B, { ...base, anchor: { kind: "record", id: crypto.randomUUID() } })).anchor_page,
    null,
  );
  assertEquals(
    (await search(d, A, { ...base, query: "없는 말", anchor: { kind: "record", id: crypto.randomUUID() } }))
      .anchor_page,
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
      { entity_id: `00000000-0000-4000-8000-000000000001:00000000-0000-4000-8000-000000000001:${crypto.randomUUID()}` },
      { entity_id: entity },
      { kinds: ["record"] as ("record")[] },
    ]
  ) await assertRejects(() => search(d, A, { ...base, ...change, cursor: first.next_cursor! }), AppError);
  await assertRejects(() => search(d, B, { ...base, cursor: first.next_cursor! }), AppError);
  const only = await search(
    d,
    A,
    searchInput.parse({ query: "%_", tag_id: tagId, from: at, to: "2099-01-01T00:00:00Z" }),
  );
  assertEquals(only.items.map((x) => x.kind), ["record"]);
  assertEquals(only.search_state, "keyword_fallback");
  assertEquals(only.semantic_coverage.pending, 1);
  const none = await search(d, A, searchInput.parse({ query: "없는 말", tag_id: tagId }));
  assertEquals(none.items, []);
  assertEquals(none.semantic_coverage.pending, 1);
  const foreign = await search(d, B, searchInput.parse({ query: token, tag_id: tagId }));
  assertEquals(foreign.semantic_coverage.pending, 0);
  assertEquals(foreign.items, []);
  assertEquals((await search(d, A, searchInput.parse({ query: token }))).items.length, 2);
  assertEquals(
    (await search(d, A, searchInput.parse({ query: token, kinds: ["record"], from: "2099-01-01T00:00:00Z" }))).items,
    [],
  );
  assertEquals(
    (await search(d, A, searchInput.parse({ query: token, entity_id: entity }))).items.map((item) => item.id),
    [task.id],
  );
  const noMatch = await search(d, A, searchInput.parse({ query: "없는 말", entity_id: entity, tag_id: taskTag }));
  assertEquals(noMatch.semantic_coverage, { pending: 0, excluded: 0, failed: 0 });
  const foreignEntity = await search(d, B, searchInput.parse({ query: token, entity_id: entity }));
  assertEquals(foreignEntity.items, []);
  assertEquals(foreignEntity.semantic_coverage, { pending: 0, excluded: 0, failed: 0 });
});

dbTest(
  "search: current grant revocation commits while query embedding waits and fences every returned projection",
  async () => {
    const owned = await businessWorkspaceFixture(admin, sql);
    const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
    let pending: ReturnType<typeof search> | undefined;
    try {
      await owned.grant(owned.member, [{ target_kind: "tasks", target_id: "*", access: "write" }]);
      const task = await activity.createTask(
        activityDeps,
        businessRequest(owned.member),
        taskCreate.parse({
          kind: "once",
          title: "질의 대기 검증",
        }),
      );
      const completed = await activity.completeTask(activityDeps, businessRequest(owned.member), task.id, {
        expected_version: task.version,
        body: "질의 공급자 대기 중 권한 변경",
      });
      const query = searchInput.parse({
        query: "질의 공급자",
        kinds: ["record"],
        anchor: { kind: "record", id: completed.record.id },
      });
      assertEquals((await search(d, owned.member, { ...query, mode: "keyword" })).items.length, 1);
      let sends = 0;
      pending = search(
        {
          ...d,
          embedder: {
            async embed(_text, type) {
              assertEquals(type, "query");
              sends++;
              entered.resolve();
              await release.promise;
              return Array.from({ length: 1024 }, (_, i) => i === 0 ? 1 : 0);
            },
          },
        },
        owned.member,
        query,
      );
      await entered.promise;
      // This public write must commit before the fake query provider returns;
      // retaining a DB grant lock during provider I/O would fail its lock timeout.
      await owned.grant(owned.member, []);
      release.resolve();
      const result = await pending;
      assertEquals(sends, 1);
      assertEquals(result.items, []);
      assertEquals(result.semantic_coverage, { pending: 0, failed: 0, excluded: 0 });
      assertEquals(result.anchor_page, null);
      assertEquals(result.next_cursor, null);
      await assertRejects(() => activity.getRecord(activityDeps, owned.member, completed.record.id), AppError);
    } finally {
      release.resolve();
      if (pending) await pending.catch(() => {});
      await owned.cleanup();
    }
  },
);

dbTest("search fixture cleanup", async () => {
  await fixture.cleanup();
});

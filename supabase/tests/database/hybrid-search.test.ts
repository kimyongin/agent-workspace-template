import { assertEquals, assertMatch, assertRejects } from "@std/assert";
import { SqlSearchUnitOfWork } from "../../functions/_shared/adapters/supabase/search-store.ts";
import { search } from "../../functions/_shared/core/search/application.ts";
import { searchInput } from "../../functions/_shared/contracts/search.ts";
import { SEARCH_PIPELINE } from "../../functions/_shared/core/search/config.ts";
import { EmbeddingError } from "../../functions/_shared/core/search/index-worker.ts";
import { AppError } from "../../functions/_shared/core/shared/errors.ts";
import { asUser, connect, dbTest, devUsers, outcome, urls } from "./_db.ts";
const admin = connect(urls.admin, { max: 1 }),
  sql = connect(urls.pooler, { max: 3, prepare: false }),
  users = await devUsers(admin);
const vector = (a: number, b = 0) => Array.from({ length: 1024 }, (_, i) => i === 0 ? a : i === 1 ? b : 0);
const d = { uow: new SqlSearchUnitOfWork(sql), embedder: { embed: () => Promise.resolve(vector(1)) } },
  A = { userId: users.a };
dbTest("의미 검색: 3종류·hybrid 순위/anchor/커서·현재성·권한·필터·장애 대체", async () => {
  await admin`delete from private.search_embedding_budget where owner_id=${users.a}`;
  const tag = crypto.randomUUID(), ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  const at = "2002-02-03T00:00:00.000Z";
  await asUser(sql, users.a, async (tx) => {
    await tx`insert into app.tags(id,owner_id,name) values(${tag},${users.a},${tag.slice(0, 30)})`;
    await tx`insert into app.tasks(id,owner_id,kind,status,title,summary,body,updated_at) values(${
      ids[0]
    },${users.a},'once','open','복구 계획','원칙 설명','원문',${at})`;
    await tx`insert into app.records(id,owner_id,title,summary,body,occurred_at) values(${
      ids[1]
    },${users.a},'검토','단어 없음','본문 복구',${at})`;
    await tx`insert into app.principles(id,owner_id,title,summary,body,updated_at) values(${
      ids[2]
    },${users.a},'서버 장애','해결 절차','원문',${at})`;
    await tx`insert into app.task_tags(owner_id,task_id,tag_id) values(${users.a},${ids[0]},${tag})`;
    await tx`insert into app.record_tags(owner_id,record_id,tag_id) values(${users.a},${ids[1]},${tag})`;
    await tx`insert into app.principle_tags(owner_id,principle_id,tag_id) values(${users.a},${ids[2]},${tag})`;
  });
  for (const [n, kind] of ["task", "record", "principle"].entries()) {
    const source = n === 0 ? "tasks" : n === 1 ? "records" : "principles";
    await admin.unsafe(
      `insert into app.search_index_state(owner_id,kind,id,input_hash,pipeline,state,embedding)
      select owner_id,$1,id,encode(extensions.digest(title||E'\\n'||summary,'sha256'),'hex'),$2,'indexed',$3::extensions.vector
      from app.${source} where id=$4`,
      [kind, SEARCH_PIPELINE, JSON.stringify(n === 0 ? vector(1) : n === 1 ? vector(0, 1) : vector(.8, .6)), ids[n]],
    );
  }
  const q = searchInput.parse({ query: "복구", tag_id: tag, from: at, to: at, limit: 1 });
  const first = await search(d, A, q);
  assertEquals(first.search_state, "ok");
  assertEquals(first.items.map((x) => [x.id, x.match]), [[ids[0], "both"]]);
  assertEquals(first.semantic_coverage, { pending: 0, excluded: 0 });
  const entity = crypto.randomUUID(), otherEntity = crypto.randomUUID();
  await asUser(sql, users.a, async (tx) => {
    await tx`insert into app.entities(id,owner_id,prop1) values(${entity},${users.a},'의미 범위'),(${otherEntity},${users.a},'다른 범위')`;
    await tx`update app.tasks set entity_id=${entity} where id=${ids[0]}`;
    await tx`update app.records set entity_id=${otherEntity} where id=${ids[1]}`;
    await tx`update app.principles set entity_id=${entity} where id=${ids[2]}`;
    const [excluded] =
      await tx`insert into app.records(owner_id,title,summary,body,entity_id,occurred_at) values(${users.a},'색인 제외','','질의 없음',${entity},${at}) returning id`;
    await tx`insert into app.record_tags(owner_id,record_id,tag_id) values(${users.a},${excluded.id},${tag})`;
  });
  const scoped = await search(d, A, { ...q, entity_id: entity, limit: 20, anchor: { kind: "record", id: ids[1] } });
  assertEquals(scoped.items.map((x) => [x.id, x.match]), [[ids[0], "both"], [ids[2], "semantic"]]);
  assertEquals(scoped.semantic_coverage, { pending: 0, excluded: 1 });
  assertEquals(scoped.anchor_page, null);
  assertEquals((await search(d, A, { ...q, entity_id: otherEntity })).items.map((x) => x.id), [ids[1]]);
  await assertRejects(() => search(d, A, { ...q, entity_id: entity, cursor: first.next_cursor! }), AppError);
  assertEquals("rank" in first.items[0], false);
  const second = await search(d, A, { ...q, cursor: first.next_cursor! });
  assertEquals(second.items.map((x) => [x.id, x.match]), [[ids[1], "keyword"]]);
  const third = await search(d, A, { ...q, cursor: second.next_cursor!, anchor: { kind: "principle", id: ids[2] } });
  assertEquals(third.items.map((x) => [x.id, x.match]), [[ids[2], "semantic"]]);
  assertEquals(third.anchor_page, 3);
  assertEquals(third.next_cursor, null);
  assertEquals((await search(d, A, { ...q, mode: "keyword", limit: 20 })).items.map((x) => x.id), [ids[0], ids[1]]);
  assertEquals((await search(d, { userId: users.b }, { ...q, anchor: { kind: "task", id: ids[0] } })).items, []);
  assertEquals((await search(d, A, { ...q, from: "2002-02-04T00:00:00Z", to: undefined })).items, []);
  await asUser(sql, users.a, async (tx) => {
    await tx`update app.principles set status='inactive' where id=${ids[2]}`;
  });
  assertEquals((await search(d, A, { ...q, kinds: ["principle"] })).items, []);
  assertEquals((await search(d, A, { ...q, kinds: ["principle"], status: "inactive" })).items[0].id, ids[2]);
  await admin`update app.search_index_state set pipeline='old' where id=${ids[2]}`;
  assertEquals((await search(d, A, { ...q, kinds: ["principle"], status: "all" })).semantic_coverage.pending, 1);
  assertEquals((await search(d, A, { ...q, kinds: ["principle"], status: "all" })).items, []);
  await asUser(sql, users.a, async (tx) => {
    await tx`update app.tasks set summary='해시 변경' where id=${ids[0]}`;
  });
  assertEquals((await search(d, A, q)).items[0].match, "keyword");
  const down = { ...d, embedder: { embed: () => Promise.reject(new EmbeddingError("transient")) } };
  await assertRejects(
    () => search(down, A, { ...q, cursor: first.next_cursor! }),
    AppError,
    "의미 검색을 이어갈 수 없습니다",
  );
  const fallback = await search(down, A, q);
  assertEquals(fallback.search_state, "keyword_fallback");
  assertEquals((await search(d, A, { ...q, cursor: fallback.next_cursor! })).search_state, "keyword_fallback");
  await assertRejects(() => search(d, A, { ...q, tag_id: crypto.randomUUID(), cursor: first.next_cursor! }), AppError);
  await admin`delete from private.search_embedding_budget where owner_id=${users.a}`;
});
dbTest("검색 질의 예산: 동시 21건 중 20건·다른 사용자 분리·외부 호출 전 대체", async () => {
  await admin`delete from private.search_embedding_budget where owner_id in (${users.a},${users.b})`;
  try {
    const results = await Promise.all(
      Array.from(
        { length: 21 },
        () =>
          asUser(sql, users.a, async (tx) => (await tx`select app.reserve_search_embedding() as allowed`)[0].allowed),
      ),
    );
    assertEquals(results.filter(Boolean).length, 20);
    assertEquals(
      await asUser(sql, users.b, async (tx) => (await tx`select app.reserve_search_embedding() as allowed`)[0].allowed),
      true,
    );
    let calls = 0;
    const result = await search(
      {
        ...d,
        embedder: {
          embed: () => {
            calls++;
            return Promise.resolve(vector(1));
          },
        },
      },
      A,
      searchInput.parse({ query: "없는 질의" }),
    );
    assertEquals(calls, 0);
    assertEquals(result.search_state, "keyword_fallback");
    assertMatch(
      await outcome(asUser(sql, users.a, (tx) => tx`select * from private.search_embedding_budget`)),
      /^42501/,
    );
  } finally {
    await admin`delete from private.search_embedding_budget where owner_id in (${users.a},${users.b})`;
  }
});

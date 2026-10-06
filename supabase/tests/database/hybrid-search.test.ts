import { assertEquals, assertMatch, assertRejects } from "@std/assert";
import { SqlSearchUnitOfWork } from "../../functions/_shared/adapters/supabase/search-store.ts";
import { SqlIndexQueue } from "../../functions/_shared/adapters/supabase/index-queue.ts";
import { SqlUnitOfWork } from "../../functions/_shared/adapters/supabase/activity-store.ts";
import { recordCreate, recordUpdate } from "../../functions/_shared/contracts/record.ts";
import { searchInput } from "../../functions/_shared/contracts/search.ts";
import * as activity from "../../functions/_shared/core/activity/application.ts";
import { search } from "../../functions/_shared/core/search/application.ts";
import { EmbeddingError, indexBatch } from "../../functions/_shared/core/search/index-worker.ts";
import { AppError } from "../../functions/_shared/core/shared/errors.ts";
import { asUser, connect, dbTest, fixtureOwner, outcome, urls } from "./_db.ts";
const admin = connect(urls.admin, { max: 1 }), sql = connect(urls.pooler, { max: 3, prepare: false });
const fixture = await fixtureOwner(admin), foreign = await fixtureOwner(admin), A = fixture.actor;
const workerUrl = new URL(urls.pooler);
workerUrl.username = "app_worker.pooler-dev";
workerUrl.password = encodeURIComponent(Deno.env.get("APP_WORKER_PASSWORD")!);
const worker = connect(workerUrl.href, { max: 3, prepare: false }), queue = new SqlIndexQueue(worker);
const vector = (a: number, b = 0) => Array.from({ length: 1024 }, (_, i) => i === 0 ? a : i === 1 ? b : 0);
const deps = { uow: new SqlUnitOfWork(sql), clock: { now: () => new Date() } };
const d = { uow: new SqlSearchUnitOfWork(sql), embedder: { embed: () => Promise.resolve(vector(1)) } };
dbTest(
  "body chunk search: tail match, record dedup before limit/anchor, snippets, hash freshness and ownership",
  async () => {
    const tag = crypto.randomUUID();
    await asUser(
      sql,
      A.userId,
      (tx) => tx`insert into app.tags(id,owner_id,name) values(${tag},${A.userId},${tag.slice(0, 30)})`,
    );
    const bodies = ["# 앞부분\n\n" + "한글😀".repeat(1200) + "\n\n뒷부분 회수 근거", "두번째 기록", "세번째 기록"];
    const ids: string[] = [];
    for (const [n, body] of bodies.entries()) {
      const item = await activity.createRecord(
        deps,
        A,
        recordCreate.parse({ id: crypto.randomUUID(), body, tag_ids: [tag] }),
      );
      ids.push(item.id);
      const result = await indexBatch(queue, {
        embed: (text) =>
          Promise.resolve(
            n === 0 ? (text.includes("뒷부분") ? vector(1) : vector(0, 1)) : n === 1 ? vector(.8, .6) : vector(.6, .8),
          ),
      }, { limit: 1, owner_id: A.userId, kind: "record", id: item.id });
      assertEquals(result.indexed, 1);
    }
    const q = searchInput.parse({ query: "비슷한 의미 질의", tag_id: tag, kinds: ["record"], limit: 1 });
    const first = await search(d, A, q);
    assertEquals(first.items.map((x) => [x.id, x.match]), [[ids[0], "semantic"]]);
    assertEquals(first.items[0].snippet.includes("뒷부분 회수 근거"), true);
    assertEquals(
      [...bodies[0]].slice(first.items[0].snippet_start, first.items[0].snippet_end).join(""),
      first.items[0].snippet,
    );
    assertEquals(first.semantic_coverage, { pending: 0, excluded: 0 });
    const second = await search(d, A, { ...q, cursor: first.next_cursor! });
    assertEquals(
      second.items.map((x) => x.id),
      [ids[1]],
    );
    const third = await search(d, A, { ...q, cursor: second.next_cursor!, anchor: { kind: "record", id: ids[2] } });
    assertEquals(third.items.map((x) => x.id), [ids[2]]);
    assertEquals(third.anchor_page, 3);
    assertEquals(third.next_cursor, null);
    assertEquals((await search(d, foreign.actor, q)).items, []);
    assertEquals((await search(d, foreign.actor, q)).semantic_coverage, { pending: 0, excluded: 0 });
    assertEquals(
      (await asUser(sql, foreign.actor.userId, (tx) => tx`select * from app.search_chunks where record_id=${ids[0]}`))
        .length,
      0,
    );
    await activity.updateRecord(deps, A, ids[0], recordUpdate.parse({ expected_version: 1, body: "바뀐 원문" }));
    assertEquals((await search(d, A, { ...q, limit: 20 })).items.map((x) => x.id), [ids[1], ids[2]]);
    assertEquals((await search(d, A, q)).semantic_coverage, { pending: 1, excluded: 0 });
    const down = { ...d, embedder: { embed: () => Promise.reject(new EmbeddingError("transient")) } };
    await assertRejects(() => search(down, A, { ...q, cursor: first.next_cursor! }), AppError);
    assertEquals((await search(down, A, { ...q, query: "두번째" })).search_state, "keyword_fallback");
    await assertRejects(
      () => search(d, A, { ...q, tag_id: crypto.randomUUID(), cursor: first.next_cursor! }),
      AppError,
    );
  },
);
dbTest("query budget: concurrent reservations isolate owners and fallback occurs before external call", async () => {
  await admin`delete from private.search_embedding_budget where owner_id in (${A.userId},${foreign.actor.userId})`;
  const results = await Promise.all(
    Array.from(
      { length: 21 },
      () =>
        asUser(sql, A.userId, async (tx) => (await tx`select app.reserve_search_embedding() as allowed`)[0].allowed),
    ),
  );
  assertEquals(results.filter(Boolean).length, 20);
  assertEquals(
    await asUser(
      sql,
      foreign.actor.userId,
      async (tx) => (await tx`select app.reserve_search_embedding() as allowed`)[0].allowed,
    ),
    true,
  );
  let calls = 0;
  assertEquals(
    (await search(
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
    )).search_state,
    "keyword_fallback",
  );
  assertEquals(calls, 0);
  assertMatch(
    await outcome(asUser(sql, A.userId, (tx) => tx`select * from private.search_embedding_budget`)),
    /^42501/,
  );
});
dbTest("hybrid-search fixture cleanup", async () => {
  await fixture.cleanup();
  await foreign.cleanup();
});

import { assertEquals, assertRejects } from "@std/assert";
import { search, type SearchDeps, type SearchStore } from "./application.ts";
import { searchInput, type SearchItem } from "../../contracts/search.ts";
import { EmbeddingError } from "./index-worker.ts";
import { AppError } from "../shared/errors.ts";
const actor = { userId: crypto.randomUUID() }, vector = Array.from({ length: 1024 }, (_, i) => i === 0 ? 1 : 0);
const item: SearchItem = {
  kind: "record",
  id: crypto.randomUUID(),
  title: "검색",
  snippet: "요약",
  snippet_start: 0,
  snippet_end: 2,
  at: "2000-01-01T00:00:00.000Z",
  tag_ids: [],
  match: "keyword",
  index_state: "indexed",
  path: "/records/id",
};
function deps(embedder: SearchDeps["embedder"], allowed = true) {
  let reservations = 0, calls = 0;
  const store: SearchStore = {
    candidates: (_q, _vector, after) =>
      Promise.resolve(
        after ? [{ ...item, rank: 1 }] : [{ ...item, rank: 1 }, { ...item, id: crypto.randomUUID(), rank: 1 }],
      ),
    coverage: () => Promise.resolve({ pending: 0, excluded: 0 }),
    anchorPage: () => Promise.resolve(null),
    reserveEmbedding: () => {
      reservations++;
      return Promise.resolve(allowed);
    },
  };
  return {
    d: {
      uow: { run: <T>(_a: typeof actor, fn: (s: SearchStore) => Promise<T>) => fn(store) },
      ...(embedder
        ? {
          embedder: {
            embed: (text: string, type: "passage" | "query") => {
              calls++;
              return embedder.embed(text, type);
            },
          },
        }
        : {}),
    },
    counts: () => ({ reservations, calls }),
  };
}
Deno.test("검색 실패 경계: 첫 페이지 대체·대체 커서 고정·진행 중 실패/벡터 변경 거부", async () => {
  const q = searchInput.parse({ query: "질의", limit: 1 });
  const down = deps({ embed: () => Promise.reject(new EmbeddingError("transient")) });
  const first = await search(down.d, actor, q);
  assertEquals(first.search_state, "keyword_fallback");
  const up = deps({
    embed: (text, type) => {
      assertEquals(text, "질의");
      assertEquals(type, "query");
      return Promise.resolve(vector);
    },
  });
  assertEquals((await search(up.d, actor, { ...q, cursor: first.next_cursor! })).search_state, "keyword_fallback");
  assertEquals(up.counts(), { reservations: 0, calls: 0 });
  const semantic = await search(up.d, actor, q);
  assertEquals(semantic.search_state, "ok");
  await assertRejects(
    () => search(down.d, actor, { ...q, cursor: semantic.next_cursor! }),
    AppError,
    "의미 검색을 이어갈 수 없습니다",
  );
  const changed = deps({ embed: () => Promise.resolve(vector.map((x) => x ? 0 : 1)) });
  await assertRejects(() => search(changed.d, actor, { ...q, cursor: semantic.next_cursor! }), AppError);
});
Deno.test("검색 호출 경계: 잘못된 커서·키워드·예산 초과는 외부 호출 없음", async () => {
  const state = deps({ embed: () => Promise.resolve(vector) }), q = searchInput.parse({ query: "질의" });
  await assertRejects(() => search(state.d, actor, { ...q, cursor: "invalid" }), AppError);
  await search(state.d, actor, { ...q, mode: "keyword" });
  assertEquals(state.counts(), { reservations: 0, calls: 0 });
  const blocked = deps({ embed: () => Promise.resolve(vector) }, false);
  assertEquals((await search(blocked.d, actor, q)).search_state, "keyword_fallback");
  assertEquals(blocked.counts(), { reservations: 1, calls: 0 });
});

Deno.test("current task/principle searches use keyword lookup without embedding or query budget", async () => {
  const state = deps({ embed: () => Promise.resolve(vector) });
  const q = searchInput.parse({ query: "질의", kinds: ["task", "principle"], limit: 1 });
  const first = await search(state.d, actor, q);
  await search(state.d, actor, { ...q, cursor: first.next_cursor! });
  assertEquals(state.counts(), { reservations: 0, calls: 0 });
  assertEquals(first.search_state, "ok");
});

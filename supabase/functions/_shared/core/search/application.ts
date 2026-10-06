import { z } from "zod";
import { id, isoDateTime } from "../../contracts/common.ts";
import { type SearchInput, type SearchItem, searchKind, type SearchResult } from "../../contracts/search.ts";
import type { Actor } from "../shared/actor.ts";
import { AppError, invalidInput } from "../shared/errors.ts";
import { scopeOf, sha256Hex } from "../shared/operations.ts";
import { SEARCH_PIPELINE } from "./config.ts";
import { type Embedder, EmbeddingError } from "./index-worker.ts";
const position = z.strictObject({
  at: isoDateTime,
  kind: searchKind,
  id,
  scope: z.string(),
  rank: z.number().finite(),
  ranking: z.enum(["hybrid", "keyword", "fallback"]),
  vector_hash: z.string().nullable(),
});
export type SearchPosition = Pick<SearchItem, "at" | "kind" | "id"> & { rank: number };
export type SearchRow = SearchItem & { rank: number };
export interface SearchStore {
  candidates(q: SearchInput, vector: number[] | undefined, after?: SearchPosition): Promise<SearchRow[]>;
  coverage(q: SearchInput): Promise<SearchResult["semantic_coverage"]>;
  anchorPage(q: SearchInput, vector: number[] | undefined): Promise<number | null>;
  reserveEmbedding(): Promise<boolean>;
}
export interface SearchDeps {
  uow: { run<T>(a: Actor, fn: (s: SearchStore) => Promise<T>): Promise<T> };
  embedder?: Embedder;
}
export async function search(d: SearchDeps, a: Actor, q: SearchInput): Promise<SearchResult> {
  const keywordOnly = q.mode === "keyword" || !q.kinds.includes("record");
  const { cursor: _cursor, limit: _limit, anchor: _anchor, ...filter } = q;
  const scope = await scopeOf(a, {
    search: { ...filter, kinds: [...q.kinds].sort() },
    pipeline: SEARCH_PIPELINE,
    ranking: "hybrid-v1",
  });
  let after: z.infer<typeof position> | undefined;
  if (q.cursor) {
    try {
      const p = position.parse(JSON.parse(atob(q.cursor.replace(/-/g, "+").replace(/_/g, "/"))));
      if (
        p.scope !== scope || (keywordOnly && p.ranking !== "keyword") ||
        (!keywordOnly && p.ranking === "keyword") || (p.ranking === "hybrid") !== (p.vector_hash !== null)
      ) throw new Error("scope");
      after = p;
    } catch {
      throw invalidInput("cursor가 이 검색 조건의 것이 아닙니다", [{
        path: "cursor",
        message: "유효하지 않은 cursor",
      }]);
    }
  }
  // 먼저 커서를 검증하고 공급자 호출은 DB 트랜잭션 밖에서 수행한다.
  let vector: number[] | undefined;
  if (!keywordOnly && after?.ranking !== "fallback" && d.embedder) {
    const allowed = await d.uow.run(a, (s) => s.reserveEmbedding());
    if (allowed) {
      try {
        vector = await d.embedder.embed(q.query, "query");
      } catch (error) {
        if (!(error instanceof EmbeddingError)) throw error;
      }
    }
  }
  const ranking = keywordOnly ? "keyword" : vector ? "hybrid" : "fallback";
  const vectorHash = vector ? await sha256Hex(JSON.stringify(vector)) : null;
  if (after?.ranking === "hybrid" && (ranking !== "hybrid" || after.vector_hash !== vectorHash)) {
    throw new AppError("unavailable", "의미 검색을 이어갈 수 없습니다. 다시 시도하거나 검색을 새로 시작하세요");
  }
  return d.uow.run(a, async (s) => {
    const coverage = await s.coverage(q),
      rows = await s.candidates(q, vector, after),
      selected = rows.slice(0, q.limit),
      items = selected.map(({ rank: _rank, ...item }) => item),
      last = selected.at(-1);
    const next = rows.length > q.limit && last
      ? btoa(
        JSON.stringify({
          at: last.at,
          kind: last.kind,
          id: last.id,
          scope,
          rank: last.rank,
          ranking,
          vector_hash: vectorHash,
        }),
      ).replace(/\+/g, "-").replace(
        /\//g,
        "_",
      ).replace(/=+$/, "")
      : null;
    return {
      anchor_page: await s.anchorPage(q, vector),
      items,
      next_cursor: next,
      search_state: ranking === "fallback" ? "keyword_fallback" : "ok",
      semantic_coverage: coverage,
    };
  });
}

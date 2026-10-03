import { z } from "zod";
import { id, isoDateTime } from "../../contracts/common.ts";
import { type SearchInput, type SearchItem, searchKind, type SearchResult } from "../../contracts/search.ts";
import type { Actor } from "../shared/actor.ts";
import { invalidInput } from "../shared/errors.ts";
import { scopeOf } from "../shared/operations.ts";
import { SEARCH_PIPELINE } from "./config.ts";
const position = z.strictObject({ at: isoDateTime, kind: searchKind, id, scope: z.string() });
export type SearchPosition = Pick<SearchItem, "at" | "kind" | "id">;
export interface SearchStore {
  keyword(q: SearchInput, after?: SearchPosition): Promise<SearchItem[]>;
  coverage(q: SearchInput): Promise<SearchResult["semantic_coverage"]>;
  anchorPage(q: SearchInput): Promise<number | null>;
}
export interface SearchDeps {
  uow: { run<T>(a: Actor, fn: (s: SearchStore) => Promise<T>): Promise<T> };
}
export async function search(d: SearchDeps, a: Actor, q: SearchInput): Promise<SearchResult> {
  const { cursor: _cursor, limit: _limit, anchor: _anchor, ...filter } = q;
  const scope = await scopeOf(a, {
    search: { ...filter, kinds: [...q.kinds].sort() },
    pipeline: SEARCH_PIPELINE,
    ranking: "keyword-v1",
  });
  let after: SearchPosition | undefined;
  if (q.cursor) {
    try {
      const p = position.parse(JSON.parse(atob(q.cursor.replace(/-/g, "+").replace(/_/g, "/"))));
      if (p.scope !== scope) throw new Error("scope");
      after = p;
    } catch {
      throw invalidInput("cursor가 이 검색 조건의 것이 아닙니다", [{
        path: "cursor",
        message: "유효하지 않은 cursor",
      }]);
    }
  }
  return d.uow.run(a, async (s) => {
    const coverage = await s.coverage(q),
      rows = await s.keyword(q, after),
      items = rows.slice(0, q.limit),
      last = items.at(-1);
    const next = rows.length > q.limit && last
      ? btoa(JSON.stringify({ at: last.at, kind: last.kind, id: last.id, scope })).replace(/\+/g, "-").replace(
        /\//g,
        "_",
      ).replace(/=+$/, "")
      : null;
    // 의미 파이프라인 연결 전에는 auto 요청도 키워드 대체임을 명시한다.
    return {
      anchor_page: await s.anchorPage(q),
      items,
      next_cursor: next,
      search_state: q.mode === "keyword" ? "ok" : "keyword_fallback",
      semantic_coverage: coverage,
    };
  });
}

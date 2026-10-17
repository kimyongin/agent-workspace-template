import type { SearchItem } from "@contracts/search.ts";

const matchNames = { both: "키워드·의미", keyword: "키워드", semantic: "의미" };
const indexNames = { pending: "색인 대기", excluded: "색인 제외", indexed: "색인 완료" };

export function SearchMatch({ item }: { item: Pick<SearchItem, "match" | "index_state"> }) {
  return (
    <dl className="key-value-grid search-match-data">
      <div>
        <dt>검색 일치</dt>
        <dd>{matchNames[item.match]}</dd>
      </div>
      <div>
        <dt>색인 상태</dt>
        <dd>{indexNames[item.index_state]}</dd>
      </div>
    </dl>
  );
}

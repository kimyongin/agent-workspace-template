import { Badge } from "./ui/badge.tsx";
import type { SearchItem } from "@contracts/search.ts";

const matchNames = { both: "키워드·의미", keyword: "키워드", semantic: "의미" };
const indexNames = { pending: "색인 대기", excluded: "색인 제외", indexed: "색인 완료", failed: "확인 필요" };

export function SearchMatch({ item }: { item: Pick<SearchItem, "match" | "index_state"> }) {
  return (
    <dl className="grid min-w-0 grid-cols-2 gap-4 text-sm [&_dt]:text-xs [&_dt]:text-muted-foreground">
      <div>
        <dt>검색 일치</dt>
        <dd><Badge variant="secondary">{matchNames[item.match]}</Badge></dd>
      </div>
      <div>
        <dt>색인 상태</dt>
        <dd><Badge variant="outline">{indexNames[item.index_state]}</Badge></dd>
      </div>
    </dl>
  );
}

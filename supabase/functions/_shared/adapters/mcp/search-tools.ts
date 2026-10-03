import { searchInput } from "../../contracts/search.ts";
import { search, type SearchDeps } from "../../core/search/application.ts";
import { parse } from "../errors.ts";
import type { ToolDef } from "./tools.ts";
export function searchTools(d: SearchDeps): ToolDef[] {
  return [{
    name: "search",
    description:
      "내 할 일·기록·원칙 검색. auto는 제목+요약 의미와 제목·요약·본문 키워드를 합친다. 질의는 Pinecone로 전송되며 keyword는 외부 호출이 없다. 원칙 기본 active. 대체/색인 대기·제외 수를 확인하고 원문은 get_*로 읽는다. next_cursor는 같은 조건에만 사용하며 의미 페이지 오류는 재시도하거나 처음부터 검색한다. 선택 anchor의 현재 페이지는 anchor_page, 결과 밖은 null.",
    input: searchInput,
    readOnly: true,
    handler: (i, a) => search(d, a, parse(searchInput, i)),
  }];
}

import { searchInput } from "../../contracts/search.ts";
import { search, type SearchDeps } from "../../core/search/application.ts";
import { parse } from "../errors.ts";
import type { ToolDef } from "./tools.ts";
export function searchTools(d: SearchDeps): ToolDef[] {
  return [{
    name: "search",
    description:
      "내 할 일·기록·원칙의 제목·요약·본문 검색. 원칙 기본 active. auto 대체 여부·색인 대기 수를 확인하고 본문은 get_*로 읽는다. next_cursor는 같은 검색 조건에서만 사용한다.",
    input: searchInput,
    readOnly: true,
    handler: (i, a) => search(d, a, parse(searchInput, i)),
  }];
}

import { searchInput } from "../../contracts/search.ts";
import { search, type SearchDeps } from "../../core/search/application.ts";
import { parse } from "../errors.ts";
import type { ToolDef } from "./tools.ts";
export function searchTools(d: SearchDeps): ToolDef[] {
  return [{
    name: "search",
    description:
      "현재 공간·읽기 권한의 자료·할 일·기록 검색. auto는 종류에서 선택한 현재 자료 텍스트·기록 본문 구간의 의미 검색과 업무 키워드 검색을 합친다. 자료·기록 의미 검색의 질의는 Pinecone로 전송되며 keyword와 할 일만의 검색은 외부 호출이 없다. 같은 원본은 하나의 결과로 반환한다. kind·path·source_fields·snippet과 색인 대기·확인 필요·제외 수를 확인하고 원문은 get_entity/get_record/get_task로 읽는다. next_cursor는 같은 공간·계정·조건에만 사용하며 의미 페이지 오류는 재시도하거나 처음부터 검색한다. 선택 anchor의 현재 페이지는 anchor_page, 결과 밖은 null.",
    input: searchInput,
    readOnly: true,
    handler: (i, a) => search(d, a, parse(searchInput, i)),
  }];
}

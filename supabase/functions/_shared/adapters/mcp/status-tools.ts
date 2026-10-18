import { indexingIssuesInput, statusInput } from "../../contracts/status.ts";
import { getStatus, listIndexingIssues, type StatusDeps } from "../../core/status/application.ts";
import { parse } from "../errors.ts";
import type { ToolDef } from "./tools.ts";
export function statusTools(d: StatusDeps): ToolDef[] {
  return [{
    name: "get_status",
    description:
      "현재 공간·원본 읽기 권한에 속하는 자료·할 일·기록 개수와 최근 30일 활동을 조회한다. 자료·할 일의 삭제 보관 상태도 현재 보관 데이터 집계에 포함한다. indexing은 기록 단위, entity_indexing은 자료 단위 색인 상태다. 각 waiting은 오래 갱신되지 않은 준비 상태의 수·가장 오래된 갱신 시각·점검 기준 분을 제공하며 실패나 원인을 확정하지 않는다. 오래 대기하면 관리자 점검이 필요하다. 기본 시간대 Asia/Seoul. 색인 일별 분포는 작성일별 현재 상태이며 과거 대기량 이력이 아니다. 상태 조회는 외부 호출·쓰기·작업 소비를 수행하지 않는다.",
    input: statusInput,
    readOnly: true,
    handler: (i, a) => getStatus(d, a, parse(statusInput, i)),
  }, {
    name: "list_indexing_issues",
    description:
      "현재 공간·원본 읽기 권한의 색인 확인 필요 자료·기록을 최근 작성 순으로 최대 5개 조회한다. kind·path로 원문을 구분하고 같은 공간·계정의 next_cursor로 다음 페이지를 조회한다. 공개 이유·시도 수·본문 구간 진행만 제공하며 응답 확인 불가는 확정 실패가 아니다. 내부 effect ID·벡터·공급자 응답을 공개하지 않으며 외부 호출·쓰기·작업 소비를 수행하지 않는다.",
    input: indexingIssuesInput,
    readOnly: true,
    handler: (i, a) => listIndexingIssues(d, a, parse(indexingIssuesInput, i)),
  }];
}

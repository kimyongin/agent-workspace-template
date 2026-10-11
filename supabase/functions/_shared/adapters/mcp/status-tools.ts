import { indexingIssuesInput, statusInput } from "../../contracts/status.ts";
import { getStatus, listIndexingIssues, type StatusDeps } from "../../core/status/application.ts";
import { parse } from "../errors.ts";
import type { ToolDef } from "./tools.ts";
export function statusTools(d: StatusDeps): ToolDef[] {
  return [{
    name: "get_status",
    description:
      "내 현재 엔터티·할 일·기록 개수, 최근 30일 작성·일회성 완료와 색인 상태를 서버에서 조회한다. indexing.waiting은 오래 갱신되지 않은 준비 상태의 수·가장 오래된 갱신 시각·점검 기준 분을 제공하며 실패나 원인을 확정하지 않는다. 오래 대기하면 관리자 점검이 필요하다. 기본 시간대 Asia/Seoul. 색인 일별 분포는 작성일별 현재 상태이며 과거 대기량 이력이 아니다. 삭제된 할 일·기록은 활동 집계에서도 빠진다. 외부 호출과 쓰기를 수행하지 않는다.",
    input: statusInput,
    readOnly: true,
    handler: (i, a) => getStatus(d, a, parse(statusInput, i)),
  }, {
    name: "list_indexing_issues",
    description:
      "내 현재 색인 확인 필요 기록을 최근 작성 순으로 최대 5개 조회한다. next_cursor로 다음 페이지를 조회한다. 이유·시도 수·본문 구간 진행만 반환하며 응답 확인 불가는 확정 실패가 아니다. 외부 호출·쓰기를 수행하지 않는다.",
    input: indexingIssuesInput,
    readOnly: true,
    handler: (i, a) => listIndexingIssues(d, a, parse(indexingIssuesInput, i)),
  }];
}

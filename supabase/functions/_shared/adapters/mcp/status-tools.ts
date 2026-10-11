import { statusInput } from "../../contracts/status.ts";
import { getStatus, type StatusDeps } from "../../core/status/application.ts";
import { parse } from "../errors.ts";
import type { ToolDef } from "./tools.ts";
export function statusTools(d: StatusDeps): ToolDef[] {
  return [{
    name: "get_status",
    description:
      "내 현재 엔터티·할 일·기록 개수, 최근 30일 작성·일회성 완료와 색인 상태를 서버에서 조회한다. 기본 시간대 Asia/Seoul. 색인 일별 분포는 작성일별 현재 상태이며 과거 대기량 이력이 아니다. 삭제된 할 일·기록은 활동 집계에서도 빠진다. 외부 호출과 쓰기를 수행하지 않는다.",
    input: statusInput,
    readOnly: true,
    handler: (i, a) => getStatus(d, a, parse(statusInput, i)),
  }];
}

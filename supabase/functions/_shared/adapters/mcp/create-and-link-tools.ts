import { createAndLinkInput } from "../../contracts/create-and-link.ts";
import { type CreateAndLinkDeps, createAndLinkEntity } from "../../core/entity-relations/create-and-link.ts";
import { keyedTool, type ToolDef } from "./tools.ts";
export function createAndLinkTools(d: CreateAndLinkDeps): ToolDef[] {
  return [keyedTool({
    name: "create_and_link_entity",
    description:
      "원점 관계에 새 상대 자료를 작성하거나 명시 복원하고 연결을 한 요청으로 확정합니다. 원점이 one이면 검토한 기존 상대를 교체합니다. entity는 기존 자료 생성·기본값·식별 계약을 사용하며 자동 번호는 서버가 발급합니다. 정의·원점 현재 버전과 검토한 previous_other_id/expected_previous_version을 유지하세요(빈자리·복수는 둘 다 null). 실패하면 새 자료·기존 연결·모든 기록을 원복합니다. 응답 불명은 같은 request_key와 정확한 입력으로 재확인하세요. 반환 entity.version은 연결 변경 후 최종 버전입니다.",
    input: createAndLinkInput,
    readOnly: false,
    handler: (i, a) => createAndLinkEntity(d, a, i),
  })];
}

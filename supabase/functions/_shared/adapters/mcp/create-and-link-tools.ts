import { createAndLinkInput } from "../../contracts/create-and-link.ts";
import { type CreateAndLinkDeps, createAndLinkEntity } from "../../core/entity-relations/create-and-link.ts";
import { keyedTool, type ToolDef } from "./tools.ts";
export function createAndLinkTools(d: CreateAndLinkDeps): ToolDef[] {
  return [keyedTool({
    name: "create_and_link_entity",
    description:
      "원점 관계에 새 상대 자료를 작성/명시 복원하고 연결(원점one이면명시교체)을한요청으로확정. entity는기존자료생성입력/기본값/식별계약을사용하며자동번호는서버발급합니다. definition/원점현재버전과검토한previous_other_id/expected_previous_version을유지(빈자리/복수는둘다null). 실패에는새자료·기존연결·모든기록이원복됩니다. 응답불명은같은request_key와정확한입력으로재확인. 반환entity.version은연결변경후최종버전.",
    input: createAndLinkInput,
    readOnly: false,
    handler: (i, a) => createAndLinkEntity(d, a, i),
  })];
}

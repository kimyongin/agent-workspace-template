import { z } from "zod";
import {
  relationDefinitionCreate,
  relationDefinitionDelete,
  relationDefinitionQuery,
  relationDefinitionUpdate,
} from "../../contracts/entity-relation.ts";
import {
  createEntityRelationDefinition,
  deleteEntityRelationDefinition,
  type EntityRelationDefinitionDeps,
  getEntityRelationDefinition,
  listEntityRelationDefinitions,
  updateEntityRelationDefinition,
} from "../../core/entity-relations/application.ts";
import { keyedTool, type ToolDef } from "./tools.ts";
export function entityRelationDefinitionTools(d: EntityRelationDefinitionDeps): ToolDef[] {
  const tools: ToolDef[] = [
    {
      name: "list_entity_relation_definitions",
      description:
        "자료 관계 정의 목록. purpose=business는 양쪽 자료 종류 읽기 권한으로 필요한 현재 역할만 조회하며 설정 권한이 필요하지 않습니다. 생략은 설정 조회입니다. 종류·이름·보관 상태 필터와 커서 더 보기. ends[0/1]은 같은 종류여도 별개 역할이며 개수는 해당 끝에서 연결할 상대 수입니다.",
      input: relationDefinitionQuery,
      readOnly: true,
      handler: (i, a) => listEntityRelationDefinitions(d, a, i),
    },
    {
      name: "get_entity_relation_definition",
      description: "양쪽 역할·종류·개수와 최신 독립 버전 조회.",
      input: z.strictObject({ id: z.string().uuid(), purpose: z.literal("business").optional() }),
      readOnly: true,
      handler: (i, a) => getEntityRelationDefinition(d, a, String(i.id), i.purpose),
    },
    {
      name: "create_entity_relation_definition",
      description: "두 활성 자료 종류 사이의 역할 정의. one=0~1, many=0개 이상. 기존 일반 연결은 바꾸지 않습니다.",
      input: relationDefinitionCreate,
      readOnly: false,
      handler: (i, a) => createEntityRelationDefinition(d, a, i),
    },
    {
      name: "update_entity_relation_definition",
      description: "관계 이름·종류·개수·보관 설정. 현재 연결에 맞지 않는 종류 변경/단일 축소는 거부합니다.",
      input: relationDefinitionUpdate.extend({ id: z.string().uuid() }),
      readOnly: false,
      handler: (i, a) => {
        const { id, ...raw } = i;
        return updateEntityRelationDefinition(d, a, String(id), raw);
      },
    },
    {
      name: "delete_entity_relation_definition",
      description: "연결이 없는 관계만 명시 삭제. 사용 중이면 보관하세요.",
      input: relationDefinitionDelete.extend({ id: z.string().uuid() }),
      readOnly: false,
      destructive: true,
      handler: (i, a) => {
        const { id, ...raw } = i;
        return deleteEntityRelationDefinition(d, a, String(id), raw);
      },
    },
  ];
  return tools.map((t) => t.readOnly ? t : keyedTool(t));
}

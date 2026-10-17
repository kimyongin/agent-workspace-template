import { relationLinkQuery, relationLinkWrite, relationReplaceWrite } from "../../contracts/entity-relation-links.ts";
import {
  connectEntityRelation,
  type EntityRelationLinkDeps,
  listEntityRelationLinks,
  replaceEntityRelation,
  unlinkEntityRelation,
} from "../../core/entity-relations/links.ts";
import { keyedTool, type ToolDef } from "./tools.ts";
export function entityRelationLinkTools(d: EntityRelationLinkDeps): ToolDef[] {
  const tools: ToolDef[] = [
    {
      name: "list_entity_relation_links",
      description:
        "관계 정의/side0·1/원점 자료의 현재 연결. 삭제·보관 상대도 유지. 기본20/최대100 페이지이며 next_cursor를 따라 읽습니다.",
      input: relationLinkQuery,
      readOnly: true,
      handler: (i, a) => listEntityRelationLinks(d, a, i),
    },
    {
      name: "list_entity_relation_candidates",
      description:
        "관계 상대 종류의 활성 자료 후보. q는 제목/번호 검색. 현재 연결·자기 자신·상대 단일자리 점유 자료 제외. 다른 관계나 일반 연결은 후보를 숨기지 않습니다.",
      input: relationLinkQuery,
      readOnly: true,
      handler: (i, a) => listEntityRelationLinks(d, a, i, true),
    },
    {
      name: "connect_entity_relation",
      description:
        "정의 버전과 양쪽 자료 현재 버전으로 역할을 지정해 연결. 양쪽 one 자리는 동시 요청에서도 보호합니다. 메모·태그는 직접 지정합니다.",
      input: relationLinkWrite,
      readOnly: false,
      handler: (i, a) => connectEntityRelation(d, a, i),
    },
    {
      name: "unlink_entity_relation",
      description:
        "정의/양쪽 현재 버전으로 특정 역할 연결 해제. 삭제·보관 상대도 명시 해제 가능. 다른 관계와 일반 연결은 보존합니다.",
      input: relationLinkWrite,
      readOnly: false,
      handler: (i, a) => unlinkEntityRelation(d, a, i),
    },
    {
      name: "replace_entity_relation",
      description:
        "원점이 one인 관계의 명시 교체. 검토한 previous_other_id와 expected_previous_version 필수(빈 자리면 둘 다 null). 기존 해제/새 연결은 원자적이며 상대 one 자리를 빼앗지 않습니다.",
      input: relationReplaceWrite,
      readOnly: false,
      handler: (i, a) => replaceEntityRelation(d, a, i),
    },
  ];
  return tools.map((t) => t.readOnly ? t : keyedTool(t));
}

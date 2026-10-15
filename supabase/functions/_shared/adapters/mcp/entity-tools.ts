import { entityReferenceId as id } from "../../contracts/entity-identity.ts";
import { z } from "zod";
import { businessMeta } from "../../contracts/change.ts";
import { expectedVersion } from "../../contracts/common.ts";
import { entityCreate, entityListQuery, entityUpdate } from "../../contracts/entity.ts";
import * as entity from "../../core/entity/application.ts";
import { parse } from "../errors.ts";
import { notFound } from "../../core/shared/errors.ts";
import { keyedTool, type ToolDef } from "./tools.ts";
function idParam(value: unknown): string {
  if (!id.safeParse(value).success) throw notFound();
  return value as string;
}
export function entityTools(d: entity.EntityDeps): ToolDef[] {
  const get = z.strictObject({ id: z.unknown() }),
    update = entityUpdate.extend({ id: z.unknown() }),
    remove = z.strictObject({ id: z.unknown(), expected_version: expectedVersion, ...businessMeta });
  const tools: ToolDef[] = [
    {
      name: "list_entities",
      description:
        "내 자료 목록. entity_type_id로 자료 종류를 선택한다. keyword는 대표 이름·발급처·식별자 부분 일치. sort는 updated_at 내림차순 또는 title 오름차순. Summary는 display_properties만 포함하며 편집 전 get_entity로 전체 properties를 읽는다. 커서는 같은 조건에만 사용.",
      input: entityListQuery,
      readOnly: true,
      handler: (i, a) => entity.listEntities(d, a, parse(entityListQuery, i)),
    },
    {
      name: "get_entity",
      description:
        "자료 속성과 선택된 할 일·기록의 최근 5개 및 전체 개수. 삭제된 자료도 보관값·version·deleted_at을 반환하며 명시 복원 확인에 사용한다. 각 list 도구의 entity_id로 전체 조회. 자료는 임베딩하지 않는다.",
      input: z.strictObject({ id }),
      readOnly: true,
      handler: (i, a) => entity.getEntity(d, a, idParam(parse(get, i).id)),
    },
    {
      name: "create_entity",
      description:
        "활성 자료 종류의 자료 생성. list_entity_types와 get_entity_schema로 entity_type_id/schema_version/prop_n의 의미와 제약을 확인하고 properties를 제출한다. 기본값은 새 생성에만 적용된다. 발급처 source·external_id는 정확하게 보존한다. get_entity_type_identity의 발급처·발급 방식·version을 identity_version으로 유지한다. automatic 방식은 external_id 생략 시 서버 발급한다. 삭제된 식별자는 get_entity의 원래 타입·보관값·version을 확인하고 같은 entity_type_id 및 현재 schema_version/expected_version으로 복원한다. 타입 변경은 금지된다. schema_changed/settings_changed이면 초안을 유지하고 최신 정본을 확인한 뒤 새 의도 키로 제출한다.",
      input: entityCreate,
      readOnly: false,
      handler: (i, a) => entity.createEntity(d, a, parse(entityCreate, i)),
    },
    {
      name: "update_entity",
      description:
        "현재 schema_version/expected_version으로 properties 부분 수정. 생략한 키는 유지하고 명시 null은 스키마가 허용할 때 저장한다. 자료 종류·발급처·번호는 변경할 수 없다. schema_changed이면 초안을 유지하고 현재 정의를 확인한다.",
      input: entityUpdate.extend({ id }),
      readOnly: false,
      handler: (i, a) => {
        const { id: _id, ...fields } = i;
        entity.assertImmutableType(fields);
        idParam(i.id);
        const { id, ...rest } = parse(update, i);
        return entity.updateEntity(d, a, idParam(id), rest);
      },
    },
    {
      name: "delete_entity",
      description:
        "자료 소프트 삭제. 속성·태그·할 일/기록 연결은 보존하고 활성 후보에서 제외한다. 같은 조합·현재 버전으로 등록하면 복원한다.",
      input: z.strictObject({ id, expected_version: expectedVersion, ...businessMeta }),
      readOnly: false,
      destructive: true,
      handler: async (i, a) => {
        idParam(i.id);
        const p = parse(remove, i);
        await entity.deleteEntity(d, a, idParam(p.id), p.expected_version, p.change_note, p.change_tag_ids);
        return { deleted: idParam(p.id) };
      },
    },
  ];
  return tools.map((tool) => tool.readOnly ? tool : keyedTool(tool));
}

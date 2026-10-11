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
        "내 예제 엔터티 목록. keyword는 속성 1 부분 일치, prop3_from/to 날짜 범위, prop4 선택 필터(AND). sort는 updated_at 내림차순 또는 prop1/2/3 오름차순(빈 값 먼저). 커서는 같은 조건에만 사용.",
      input: entityListQuery,
      readOnly: true,
      handler: (i, a) => entity.listEntities(d, a, parse(entityListQuery, i)),
    },
    {
      name: "get_entity",
      description:
        "엔터티 속성과 선택된 할 일·기록의 최근 5개 및 전체 개수. 삭제된 엔터티도 보관값·version·deleted_at을 반환하며 명시 복원 확인에 사용한다. 각 list 도구의 entity_id로 전체 조회. 엔터티는 임베딩하지 않는다.",
      input: z.strictObject({ id }),
      readOnly: true,
      handler: (i, a) => entity.getEntity(d, a, idParam(parse(get, i).id)),
    },
    {
      name: "create_entity",
      description:
        "예제 엔터티 생성. 새 등록은 prop1 1~100자 필수, prop2 정수 0~1000000, prop3 날짜, prop4 a/b/c 기본 a. 발급처 source와 외부 식별자 external_id는 정확하게 보존한다. 발급처·발급 방식·설정 버전 정보가 필요하거나 오래되면 get_business_settings의 id=entity_identity로 확인한다. 현재 작업에서 확인한 설정은 재사용하고 선택한 source와 versions.entity_identity를 settings_version으로 유지한다. 최종 검사는 저장 시 수행한다. settings_changed이면 설정을 재조회하고 새 의도 키로 제출한다. short 모드의 external_id 생략은 저장 시 서버 발급이며 manual 모드는 명시 식별자가 필수다. 활성 중복은 충돌. 삭제된 조합은 get_entity로 보관값·version을 확인하고 expected_version으로 명시적으로 복원하며 생략 속성은 유지한다.",
      input: entityCreate,
      readOnly: false,
      handler: (i, a) => entity.createEntity(d, a, parse(entityCreate, i)),
    },
    {
      name: "update_entity",
      description:
        "현재 expected_version으로 속성과 발급처·식별자를 함께 정정한다. 식별 변경은 연결·사건 참조도 원자적으로 전환한다. 생략은 유지, prop2/3 null은 비우기.",
      input: entityUpdate.extend({ id }),
      readOnly: false,
      handler: (i, a) => {
        idParam(i.id);
        const { id, ...rest } = parse(update, i);
        return entity.updateEntity(d, a, idParam(id), rest);
      },
    },
    {
      name: "delete_entity",
      description:
        "엔터티 소프트 삭제. 속성·태그·할 일/기록 연결은 보존하고 활성 후보에서 제외한다. 같은 조합·현재 버전으로 등록하면 복원한다.",
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

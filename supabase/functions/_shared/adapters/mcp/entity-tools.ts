import { entityReferenceId as id } from "../../contracts/entity-identity.ts";
import { z } from "zod";
import { businessMeta } from "../../contracts/change.ts";
import { expectedVersion } from "../../contracts/common.ts";
import { entityCreate, entityListQuery, entityRekey, entityUpdate } from "../../contracts/entity.ts";
import * as entity from "../../core/entity/application.ts";
import { parse } from "../errors.ts";
import { notFound } from "../../core/shared/errors.ts";
import type { ToolDef } from "./tools.ts";
function idParam(value: unknown): string {
  if (!id.safeParse(value).success) throw notFound();
  return value as string;
}
export function entityTools(d: entity.EntityDeps): ToolDef[] {
  const get = z.strictObject({ id: z.unknown() }),
    update = entityUpdate.extend({ id: z.unknown() }),
    remove = z.strictObject({ id: z.unknown(), expected_version: expectedVersion, ...businessMeta });
  return [
    {
      name: "prepare_entity_registration",
      description:
        "등록 전에 발급처 기본값과 18자 자동 식별자를 한 번 고정하고 동일 조합의 저장값을 조회한다. create이면 반환된 source/external_id를 그대로 저장·재시도한다. restore이면 existing 보관값과 expected_version을 확인하고 등록으로 복원한다. duplicate이면 활성 중복을 거부한다.",
      input: entityCreate.pick({ source: true, external_id: true }),
      readOnly: true,
      handler: (i, a) =>
        entity.prepareEntityRegistration(d, a, parse(entityCreate.pick({ source: true, external_id: true }), i)),
    },
    {
      name: "rekey_entity",
      description:
        "별도 식별 정보 변경. 현재 expected_version 필수. 삭제된 대상을 포함한 동일 조합 충돌은 거부한다. 모든 현재 연결·사건 참조를 원자적으로 전환하고 과거 본문은 그대로 보존한다.",
      input: entityRekey.extend({ id }),
      readOnly: false,
      handler: (i, a) => {
        const { id: target, ...rest } = parse(entityRekey.extend({ id }), i);
        return entity.rekeyEntity(d, a, target, rest);
      },
    },
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
        "엔터티 속성과 선택된 할 일·기록의 최근 5개 및 전체 개수. 각 list 도구의 entity_id로 전체 조회. 엔터티는 임베딩하지 않는다.",
      input: z.strictObject({ id }),
      readOnly: true,
      handler: (i, a) => entity.getEntity(d, a, idParam(parse(get, i).id)),
    },
    {
      name: "create_entity",
      description:
        "예제 엔터티 생성. prop1 1~100자 필수, prop2 정수 0~1000000, prop3 날짜, prop4 a/b/c 기본 a. 발급처 source와 외부 식별자 external_id는 정확하게 보존한다. 먼저 prepare_entity_registration으로 사용자 설정에 따른 발급처/18자 자동 식별자를 준비하고 source/external_id를 고정하여 저장·재시도한다. 활성 중복은 충돌. 삭제된 조합은 get_entity로 보관값·version을 확인하고 expected_version으로 명시적으로 복원하며 생략 속성은 유지한다.",
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
}

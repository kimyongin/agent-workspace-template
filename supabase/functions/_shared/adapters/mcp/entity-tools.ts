import { z } from "zod";
import { businessMeta } from "../../contracts/change.ts";
import { expectedVersion, id } from "../../contracts/common.ts";
import { entityCreate, entityListQuery, entityUpdate } from "../../contracts/entity.ts";
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
        "예제 엔터티 생성. prop1 1~100자 필수, prop2 정수 0~1000000, prop3 날짜, prop4 a/b/c 기본 a. 클라이언트 UUID id 필수. 같은 id 재시도는 충돌로 거부한다.",
      input: entityCreate,
      readOnly: false,
      handler: (i, a) => entity.createEntity(d, a, parse(entityCreate, i)),
    },
    {
      name: "update_entity",
      description: "현재 expected_version으로 속성 정정. 생략은 유지, prop2/3 null은 비우기.",
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
      description: "엔터티 삭제. 할 일의 해당 선택을 제거하고 기록의 캡처 문맥과 원문을 보존한다.",
      input: z.strictObject({ id, expected_version: expectedVersion, ...businessMeta }),
      readOnly: false,
      destructive: true,
      handler: async (i, a) => {
        idParam(i.id);
        const p = parse(remove, i);
        await entity.deleteEntity(d, a, idParam(p.id), p.expected_version, p.change_note);
        return { deleted: idParam(p.id) };
      },
    },
  ];
}

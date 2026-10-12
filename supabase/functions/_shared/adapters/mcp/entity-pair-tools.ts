import { entityPairQuery, entityPairWrite } from "../../contracts/entity-pairs.ts";
import { entityReferenceId } from "../../contracts/entity-identity.ts";
import { changeEntityPair, type EntityPairDeps, listEntityLinks } from "../../core/entity-pairs/application.ts";
import { parse } from "../errors.ts";
import { keyedTool, type ToolDef } from "./tools.ts";
export function entityPairTools(d: EntityPairDeps): ToolDef[] {
  const write = entityPairWrite.extend({ id: entityReferenceId });
  const query = entityPairQuery.extend({ id: entityReferenceId });
  return [
    {
      name: "list_entity_links",
      description:
        "연결된 자료의 종류·대표 이름·삭제/보관 상태를 ID 고정 순서로 조회합니다. 양쪽 상세에서 같은 무방향 연결을 조회하며 커서는 같은 자료에만 사용합니다.",
      input: query,
      readOnly: true,
      handler: (i, a) => {
        const { id, ...q } = parse(query, i);
        return listEntityLinks(d, a, id, q);
      },
    },
    ...[{ name: "link_entities", linked: true }, { name: "unlink_entities", linked: false }].map(({ name, linked }) =>
      keyedTool({
        name,
        description: `양쪽 자료의 expected_version/expected_other_version을 검사하고 연결${
          linked ? "" : " 해제"
        }합니다. 무방향 쌍은 한 행이며 실제 변경은 양쪽 version과 기록 한 건을 원자적으로 저장합니다. 자료당 연결 한도는 100개입니다. 삭제·보관된 자료는 조회/해제할 수 있습니다.`,
        input: write,
        readOnly: false,
        handler: (i, a) => {
          const { id, ...input } = parse(write, i);
          return changeEntityPair(d, a, id, input, linked);
        },
      })
    ),
  ];
}

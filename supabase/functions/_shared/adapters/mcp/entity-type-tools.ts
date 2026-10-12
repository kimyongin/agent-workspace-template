import { z } from "zod";
import {
  entitySchemaHistory,
  entitySchemaRead,
  entityTypeCreate,
  entityTypeIcons,
  entityTypeList,
  entityTypeUpdate,
} from "../../contracts/entity-type.ts";
import {
  createEntityType,
  type EntityTypeDeps,
  getEntitySchema,
  getEntityType,
  listEntitySchemaVersions,
  listEntityTypes,
  updateEntityType,
} from "../../core/entity-types/application.ts";
import { keyedTool, type ToolDef } from "./tools.ts";
export function entityTypeTools(deps: EntityTypeDeps): ToolDef[] {
  const tools: ToolDef[] = [
    {
      name: "list_entity_type_icons",
      description: "자료 종류의 지원 icon_id·라벨 목록. 알 수 없는 저장 아이콘은 box로 표시합니다.",
      input: z.strictObject({}),
      readOnly: true,
      handler: () => Promise.resolve({ items: entityTypeIcons }),
    },
    {
      name: "list_entity_types",
      description: "현재 소유자의 자료 종류 목록. include_archived, limit/cursor로 보관 상태와 bounded 페이지 조회.",
      input: entityTypeList,
      readOnly: true,
      handler: (i, a) => listEntityTypes(deps, a, i),
    },
    {
      name: "get_entity_type",
      description: "자료 종류의 이름·아이콘·보관 상태·metadata version·현재 schema_version 조회.",
      input: z.strictObject({ type_id: z.string().uuid() }),
      readOnly: true,
      handler: (i, a) => getEntityType(deps, a, String(i.type_id)),
    },
    {
      name: "create_entity_type",
      description: "자료 종류와 초기 필수 대표 텍스트 prop_1 정의를 원자적으로 생성. 새 ID는 성공 응답으로 발급.",
      input: entityTypeCreate,
      readOnly: false,
      handler: (i, a) => createEntityType(deps, a, i),
    },
    {
      name: "update_entity_type",
      description:
        "자료 종류 이름·icon_id·archived 수정. expected_type_version과 expected_schema_version 모두 필요. 속성/값을 변경하지 않습니다.",
      input: entityTypeUpdate.safeExtend({ type_id: z.string().uuid() }),
      readOnly: false,
      handler: (i, a) => {
        const { type_id, ...input } = i;
        return updateEntityType(deps, a, String(type_id), input);
      },
    },
    {
      name: "get_entity_schema",
      description:
        "type_id별 현재 또는 schema_version의 불변 Draft 2020-12 정의·표시 설정 조회. 기본값은 생성에만 적용.",
      input: entitySchemaRead,
      readOnly: true,
      handler: (i, a) => getEntitySchema(deps, a, i),
    },
    {
      name: "list_entity_schema_versions",
      description:
        "type_id별 불변 버전 목록을 최신순으로 조회. limit/before 페이지. metadata version과 schema_version은 별개.",
      input: entitySchemaHistory,
      readOnly: true,
      handler: (i, a) => listEntitySchemaVersions(deps, a, i),
    },
  ];
  return tools.map((tool) => tool.readOnly ? tool : keyedTool(tool));
}

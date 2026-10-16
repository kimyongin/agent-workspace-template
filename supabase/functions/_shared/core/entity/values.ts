import type { EntitySchemaVersion, EntityTypeRef } from "../../contracts/entity-type.ts";
import type { EntityProperties } from "../../contracts/entity.ts";
import { validateEntityProperties } from "../entity-types/schema-rules.ts";
import { AppError, invalidInput, notFound } from "../shared/errors.ts";
export type EntityDefinition = Pick<EntitySchemaVersion, "schema" | "type_id" | "schema_version"> & {
  type: EntityTypeRef;
  type_version: number;
};
export interface EntityDefinitions {
  definition(typeId: string, lock?: boolean): Promise<EntityDefinition | null>;
}
export async function requireDefinition(s: EntityDefinitions, typeId: string, version: number, active = false) {
  const definition = await s.definition(typeId, true);
  if (!definition) throw notFound();
  const current = { type_id: typeId, schema_version: definition.schema_version };
  if (definition.schema_version !== version) {
    throw new AppError("schema_changed", "속성 정의가 변경되었습니다. 초안을 유지하고 최신 정의를 확인하세요", [{
      path: "schema_version",
      message: "현재 속성 정의를 확인하세요",
    }], current);
  }
  if (active && definition.type.archived) {
    throw new AppError("entity_type_archived", "보관된 자료 종류는 생성·복원할 수 없습니다", [{
      path: "entity_type_id",
      message: "자료 종류를 먼저 복원하세요",
    }], current);
  }
  return definition;
}
export function checkedProperties(
  definition: EntityDefinition,
  values: Record<string, unknown>,
  patch: Record<string, unknown>,
  creation: boolean,
  previous: Record<string, unknown> = {},
): EntityProperties {
  const restricted = Object.keys(patch).find((key) => {
    const field = definition.schema.properties[key];
    return field?.readOnly && (creation || JSON.stringify(previous[key]) !== JSON.stringify(patch[key]));
  });
  if (restricted) {
    throw invalidInput("읽기 전용 속성은 변경할 수 없습니다", [{
      path: `properties.${restricted}`,
      message: "기존 값은 유지됩니다",
    }]);
  }
  const archived = Object.keys(patch).find((key) => definition.schema.properties[key]?.deprecated);
  if (archived) {
    throw invalidInput("보관 속성은 수정할 수 없습니다", [{
      path: `properties.${archived}`,
      message: "보관값은 유지됩니다",
    }]);
  }
  return validateEntityProperties(
    { schema: definition.schema },
    values,
    creation,
  ) as EntityProperties;
}

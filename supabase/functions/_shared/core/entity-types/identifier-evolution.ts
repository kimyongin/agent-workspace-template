import type { SchemaDefinition } from "../../contracts/entity-schema-change.ts";
import { invalidInput } from "../shared/errors.ts";

/** All rows, including tombstones, constrain definition changes. Call under the owning type lock. */
export function assertIdentifierEvolution(
  source: SchemaDefinition,
  target: SchemaDefinition,
  membership: { has_entities: boolean; identifier_usage: Record<string, string[]> },
) {
  const selected = source.schema["x-identity-property"];
  if (membership.has_entities && target.schema["x-identity-property"] !== selected) {
    throw invalidInput("보관된 자료를 포함해 자료가 있으면 자료 식별자를 변경할 수 없습니다", [{
      path: "schema.x-identity-property",
      message: "현재 자료 식별자를 유지하세요",
    }]);
  }
  for (const [key, used] of Object.entries(membership.identifier_usage)) {
    const allowed = target.schema.properties[key]?.["x-identifier"]?.allowed_kind_ids ?? [];
    if (used.some((kind) => !allowed.includes(kind))) {
      throw invalidInput("보관된 자료를 포함해 사용 중인 식별자 종류는 제거할 수 없습니다", [{
        path: `schema.properties.${key}.x-identifier.allowed_kind_ids`,
        message: "사용 중인 종류를 유지하세요",
      }]);
    }
  }
}

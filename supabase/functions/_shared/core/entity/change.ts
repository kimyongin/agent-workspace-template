import type { EntityValues } from "../../contracts/entity.ts";
import type { ChangeFacts, ChangeTarget } from "../shared/changes.ts";

export function entityChangeFacts(
  entity: EntityValues,
): ChangeFacts {
  return {
    identity_label: entity.identity_label,
    entity_type_id: entity.entity_type_id,
    schema_version: entity.schema_version,
    properties: entity.properties,
    title: entity.title,
    ...(entity.tag_ids === undefined ? {} : { tag_ids: entity.tag_ids }),
  };
}

export function entityChangeTarget(entity: EntityValues): ChangeTarget {
  // The change record has this entity as its single immutable parent.
  return {
    id: entity.id,
    title: entity.title,
  };
}

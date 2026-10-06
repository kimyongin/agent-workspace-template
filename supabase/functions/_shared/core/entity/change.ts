import type { EntityCreate, EntityResult } from "../../contracts/entity.ts";
import type { ChangeFacts, ChangeTarget } from "../shared/changes.ts";

export function entityChangeFacts(
  entity: Pick<EntityCreate, "prop1" | "prop2" | "prop3" | "prop4" | "tag_ids">,
): ChangeFacts {
  return {
    prop1: entity.prop1,
    prop2: entity.prop2,
    prop3: entity.prop3,
    prop4: entity.prop4,
    ...(entity.tag_ids === undefined ? {} : { tag_ids: entity.tag_ids }),
  };
}

export function entityChangeTarget(entity: EntityResult): ChangeTarget {
  // The event concerns this entity itself; SQL captures the selection, or retains it on deletion.
  return { id: entity.id, title: entity.prop1, entity_ids: [entity.id], entity_context: [] };
}

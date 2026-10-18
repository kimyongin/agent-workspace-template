import type { RecordResult } from "@contracts/record.ts";
import type { EntityDetail } from "@contracts/entity.ts";
import { useEntityReadAccess, useEntityWriteAccess } from "../entity/entity-access.ts";
import { useRelatedRead } from "../relations/useRelatedRead.ts";
import { useTaskAccess } from "./task-access.ts";

/** Resolve material authority from its current immutable parent, never historical change metadata. */
export function useRecordAccess(record: RecordResult | null) {
  const tasks = useTaskAccess();
  const canReadType = useEntityReadAccess(), canWriteType = useEntityWriteAccess();
  const parent = useRelatedRead<EntityDetail>(record?.entity_id ? `/entities/${encodeURIComponent(record.entity_id)}` : undefined, { probe: true });
  if (record?.task_id) return tasks;
  const type = parent.probe.value?.entity_type_id;
  return { canRead: !!type && canReadType(type), canWrite: !!type && canWriteType(type) };
}

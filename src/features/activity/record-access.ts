import type { RecordResult } from "@contracts/record.ts";
import type { EntityDetail } from "@contracts/entity.ts";
import { ApiError } from "../../lib/api-error.ts";
import { useEntityReadAccess, useEntityWriteAccess } from "../entity/entity-access.ts";
import { useRelatedRead } from "../relations/useRelatedRead.ts";
import { useTaskAccess } from "./task-access.ts";

/** Resolve material authority from its current immutable parent, never historical change metadata. */
export function useRecordAccess(record: RecordResult | null) {
  const tasks = useTaskAccess();
  const canReadType = useEntityReadAccess(), canWriteType = useEntityWriteAccess();
  const parent = useRelatedRead<EntityDetail>(record?.entity_id ? `/entities/${encodeURIComponent(record.entity_id)}` : undefined, { probe: true });
  if (record?.task_id) return { ...tasks, loading: false, error: false, retry: undefined };
  const probe = parent.probe;
  const denied = probe.error instanceof ApiError && (probe.error.status === 403 || probe.error.status === 404);
  const loading = !!record?.entity_id && !probe.error && (probe.loading || !probe.value);
  const type = !probe.loading && !probe.error && probe.value?.id === record?.entity_id
    ? probe.value?.entity_type_id
    : undefined;
  return {
    canRead: !!type && canReadType(type), canWrite: !!type && canWriteType(type),
    loading, error: !!probe.error && !denied,
    retry: () => { void parent.resource.read("probe"); },
  };
}

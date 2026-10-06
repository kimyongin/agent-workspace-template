import type { ChangeFacts, ChangeTarget } from "../shared/changes.ts";
import type { NewTask, Task } from "./domain.ts";
import type { ActivityRecord } from "./ports.ts";

export function taskChangeFacts(task: NewTask): ChangeFacts {
  return {
    title: task.title,
    summary: task.summary,
    body: task.body,
    status: task.status,
    kind: task.kind,
    due_on: task.due_on,
    recurrence: task.recurrence,
    timezone: task.timezone,
    tag_ids: task.tag_ids,
    pauses: task.pauses,
    ...(task.entity_ids === undefined ? {} : { entity_ids: task.entity_ids }),
  };
}

export function recordChangeFacts(record: ActivityRecord): ChangeFacts {
  return {
    title: record.title,
    summary: record.summary,
    body: record.body,
    tag_ids: record.tag_ids,
    ...(record.entity_ids === undefined ? {} : { entity_ids: record.entity_ids }),
  };
}

export function activityChangeTarget(target: Task | ActivityRecord): ChangeTarget {
  return {
    id: target.id,
    title: target.title,
    entity_ids: target.entity_ids ?? [],
    entity_context: target.entity_context ?? [],
  };
}

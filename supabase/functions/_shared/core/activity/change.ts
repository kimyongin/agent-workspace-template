import type { ChangeFacts, ChangeTarget } from "../shared/changes.ts";
import type { NewTask, Task } from "./domain.ts";
import type { ActivityRecord } from "./ports.ts";

export function taskChangeFacts(task: Omit<NewTask, "id">): ChangeFacts {
  return {
    title: task.title,
    body: task.body,
    status: task.status,
    kind: task.kind,
    due_on: task.due_on,
    recurrence: task.recurrence,
    timezone: task.timezone,
    tag_ids: task.tag_ids,
    pauses: task.pauses,
  };
}

export function recordChangeFacts(record: ActivityRecord): ChangeFacts {
  return {
    body: record.body,
    tag_ids: record.tag_ids,
  };
}

export function activityChangeTarget(target: Task | ActivityRecord): ChangeTarget {
  return {
    id: target.id,
    title: "title" in target ? target.title : Array.from(target.body).slice(0, 100).join(""),
    entity_ids: [],
    entity_context: [],
  };
}

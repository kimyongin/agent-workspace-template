import { insertWithIdRetry } from "./data-id.ts";
// Postgres 직접 연결 저장 어댑터. 트랜잭션마다 검증된 Actor 문맥을 넣고 app_user로 전환한다.
// 방식: docs/architecture/hexagonal-review.md "권한과 직접 접근"(T02-1 실험 1에서 채택).
import type postgres from "postgres";
import type { NewTask, Task } from "../../core/activity/domain.ts";
import type {
  ActivityEntry,
  ActivityRecord,
  ActivityStore,
  NewRecord,
  RecordChanges,
  RecordFilter,
  TaskFilter,
  UnitOfWork,
} from "../../core/activity/ports.ts";
import type { Actor } from "../../core/shared/actor.ts";
import { SqlActorStore } from "./sql-context.ts";
import { authorizeWorkspace, requireWorkspaceActor, runInWorkspace } from "./workspace-context.ts";
import { AppError } from "../../core/shared/errors.ts";
import { hasAnyTag, hasTag, setTagLinks, tagIdsColumn } from "./tag-links.ts";

type Tx = postgres.TransactionSql;
type Row = Record<string, unknown>;

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v === null ? null : String(v));

function toTask(r: Row): Task {
  return {
    entity_ids: (r.entity_ids as string[]) ?? [],
    entity_context: (r.entity_context as Task["entity_context"]) ?? [],
    id: r.id as string,
    kind: r.kind as Task["kind"],
    title: r.title as string,
    body: r.body as string,
    due_on: (r.due_on as string | null) ?? null,
    recurrence: (r.recurrence as Task["recurrence"]) ?? null,
    timezone: (r.timezone as string | null) ?? null,
    status: r.status as Task["status"],
    completed_at: iso(r.completed_at),
    result_record_id: (r.result_record_id as string | null) ?? null,
    pauses: (r.pauses as Task["pauses"]) ?? [],
    tag_ids: (r.tag_ids as string[]) ?? [],
    version: r.version as number,
    created_at: iso(r.created_at)!,
    updated_at: iso(r.updated_at)!,
  };
}

function toRecord(r: Row): ActivityRecord {
  return {
    entity_id: (r.entity_id as string | null) ?? null,
    record_kind: r.record_kind as "user" | "result" | "change",
    change: (r.change_metadata as ActivityRecord["change"]) ?? null,
    entity_ids: (r.entity_ids as string[]) ?? [],
    entity_context: (r.entity_context as Task["entity_context"]) ?? [],
    tag_ids: (r.tag_ids as string[]) ?? [],
    id: r.id as string,
    body: r.body as string,
    occurred_at: iso(r.occurred_at)!,
    task_id: (r.task_id as string | null) ?? null,
    occurrence_on: (r.occurrence_on as string | null) ?? null,
    version: r.version as number,
    created_at: iso(r.created_at)!,
    updated_at: iso(r.updated_at)!,
  };
}

// 날짜 컬럼은 문자열(YYYY-MM-DD)로 받는다.
const taskColumns = (tx: Tx) =>
  tx`id, array(select jsonb_array_elements_text(app.workspace_task_associations(tasks.id)->'entity_ids')) as entity_ids,
     app.workspace_task_associations(tasks.id)->'entity_context' as entity_context,
     kind, title, body, due_on::text as due_on, recurrence, timezone, status, completed_at,
     result_record_id, pauses, version, created_at, updated_at,
     ${tagIdsColumn(tx, "task")}`;
const recordColumns = (tx: Tx) =>
  tx`id, entity_id, entity_ids, entity_context, body, occurred_at, task_id, occurrence_on::text as occurrence_on, version, created_at, updated_at,
    record_kind,change_metadata,
    ${tagIdsColumn(tx, "record")}`;

/** 수정 가능한 컬럼의 허용 목록. 이 밖의 키는 SQL로 가지 않는다. */
const TASK_WRITABLE = [
  "title",
  "body",
  "due_on",
  "recurrence",
  "timezone",
  "status",
  "completed_at",
  "result_record_id",
  "pauses",
] as const;
const RECORD_WRITABLE = ["body", "occurred_at"] as const;

function pick<T extends Record<string, unknown>>(tx: Tx, values: T, allowed: readonly string[]) {
  const out: Record<string, unknown> = {};
  for (const key of allowed) {
    if (!(key in values) || values[key] === undefined) continue;
    const v = values[key];
    out[key] = key === "recurrence" || key === "pauses" ? (v === null ? null : tx.json(v as never)) : v;
  }
  return out;
}

export class SqlActivityStore extends SqlActorStore implements ActivityStore {
  private get workspaceId() {
    return requireWorkspaceActor(this.actor).workspaceId;
  }

  async visibleTask(task: Task): Promise<Task> {
    if (!task.entity_ids?.length) return { ...task, entity_ids: [], entity_context: [] };
    const visible = await this.tx<{ id: string; entity_type_id: string }[]>`select id,entity_type_id from app.entities
      where workspace_id=${this.workspaceId} and id=any(${task.entity_ids}::text[])`;
    const requirements = [...new Set(visible.map((row) => row.entity_type_id))].sort().map((id) => ({
      target_kind: "entity_type" as const,
      target_id: id,
      access: "read" as const,
    }));
    await authorizeWorkspace(this.tx, requirements);
    await this.tx`select set_config('request.workspace_requirements',(
      select coalesce(jsonb_agg(value),'[]'::jsonb)::text from (
        select distinct value from jsonb_array_elements(current_setting('request.workspace_requirements')::jsonb || ${
      this.tx.json(requirements)
    }::jsonb)
      ) required),true)`;
    const ids = new Set(visible.map((row) => row.id));
    return {
      ...task,
      entity_ids: task.entity_ids.filter((id) => ids.has(id)),
      entity_context: (task.entity_context ?? []).filter((item) => ids.has(item.id)),
    };
  }
  async getTask(id: string, opts: { forUpdate?: boolean; entityIds?: string[]; selectionWrite?: boolean } = {}) {
    if (opts.forUpdate) {
      if (opts.selectionWrite) await this.entityLinks.prepareSelection(opts.entityIds, id);
      const rows = await this.tx`select id from app.tasks where id=${id} for update`;
      if (!rows.length) return null;
    }
    const [row] = await this.tx`
      select ${taskColumns(this.tx)} from app.tasks where id = ${id}`;
    return row ? toTask(row) : null;
  }

  async listTasks(f: TaskFilter) {
    const tx = this.tx;
    const rows = await tx`
      select ${taskColumns(tx)} from app.tasks
      where true
        ${f.keyword ? tx`and position(lower(${f.keyword}) in lower(title))>0` : tx``}
        ${f.kind ? tx`and kind = ${f.kind}` : tx``}
        ${
      f.entity_id
        ? tx`and app.workspace_task_associations(tasks.id)->'entity_ids' @> jsonb_build_array(${f.entity_id}::text)`
        : tx``
    }
        ${f.status ? tx`and status = ${f.status}` : tx``}
        ${f.tag_id && !f.tag_ids?.length ? tx`and ${hasTag(tx, "task", f.tag_id)}` : tx``}
        ${f.tag_ids?.length ? tx`and ${hasAnyTag(tx, "task", [...f.tag_ids, ...(f.tag_id ? [f.tag_id] : [])])}` : tx``}
        ${f.due_from ? tx`and due_on >= ${f.due_from}` : tx``}
        ${f.due_to ? tx`and due_on <= ${f.due_to}` : tx``}
        ${f.after ? tx`and (updated_at, id) < (${f.after.at}::timestamptz, ${f.after.id}::text)` : tx``}
      order by updated_at desc, id desc
      limit ${f.limit}`;
    return rows.map(toTask);
  }

  async insertTask(task: NewTask) {
    const tx = this.tx;
    const selection = await this.entityLinks.taskSelection(task.entity_ids ?? []);
    const values = {
      workspace_id: requireWorkspaceActor(this.actor).workspaceId,
      kind: task.kind,
      ...pick(tx, task, TASK_WRITABLE),
      ...selection,
    };
    const row = await insertWithIdRetry(() =>
      tx`insert into app.tasks ${tx(values)} on conflict (id) do nothing returning id`
    );
    await this.setTaskTags(row.id as string, task.tag_ids);
    return (await this.getTask(row.id as string))!;
  }

  async setTaskTags(taskId: string, ids: string[]) {
    await setTagLinks(this.tx, this.actor, "task", taskId, ids);
  }

  async updateTask(id: string, changes: Partial<Task>) {
    const tx = this.tx;
    const values = {
      ...pick(tx, changes, TASK_WRITABLE),
      ...await this.entityLinks.taskSelection(changes.entity_ids, id),
    };
    if (changes.tag_ids !== undefined) await this.setTaskTags(id, changes.tag_ids);
    if (Object.keys(values).length === 0 && changes.tag_ids === undefined && changes.entity_ids === undefined) {
      throw new AppError("invalid_input", "바꿀 필드가 없습니다");
    }
    // set 도우미는 바로 앞의 `set` 문맥이 필요하므로 같은 템플릿에 둔다.
    const [row] = Object.keys(values).length
      ? await tx`
      update app.tasks set ${tx(values)}, version = version + 1, updated_at = now()
      where id = ${id} returning ${taskColumns(tx)}`
      : await tx`update app.tasks set version=version+1,updated_at=now() where id=${id} returning ${taskColumns(tx)}`;
    if (!row) throw new AppError("not_found", "항목을 찾을 수 없습니다");
    return toTask(row);
  }

  async deleteTask(id: string) {
    await this.tx`delete from app.tasks where id = ${id}`;
  }

  async getRecord(id: string, opts: { forUpdate?: boolean; entityIds?: string[]; selectionWrite?: boolean } = {}) {
    if (opts.forUpdate) {
      if (opts.selectionWrite) await this.entityLinks.prepareSelection(opts.entityIds, undefined, id);
      const rows = await this.tx`select id from app.records where id=${id} for update`;
      if (!rows.length) return null;
    }
    const [row] = await this.tx`
      select ${recordColumns(this.tx)} from app.records where id = ${id}`;
    return row ? toRecord(row) : null;
  }

  async getRecordBodies(ids: string[]) {
    if (ids.length === 0) return [];
    return await this.tx<{ id: string; body: string }[]>`
      select id, body from app.records where id in ${this.tx(ids)}`;
  }

  async listRecords(f: RecordFilter) {
    const tx = this.tx;
    const rows = await tx`
      select ${recordColumns(tx)} from app.records
      where true
        ${f.task_id ? tx`and task_id = ${f.task_id}` : tx``}
        ${f.record_kind ? tx`and record_kind=${f.record_kind}` : tx``}
        ${f.entity_id ? tx`and entity_ids @> ${tx.array([f.entity_id])}::text[]` : tx``}
        ${f.tag_id && !f.tag_ids?.length ? tx`and ${hasTag(tx, "record", f.tag_id)}` : tx``}
        ${
      f.tag_ids?.length ? tx`and ${hasAnyTag(tx, "record", [...f.tag_ids, ...(f.tag_id ? [f.tag_id] : [])])}` : tx``
    }
        ${f.occurred_from ? tx`and occurred_at >= ${f.occurred_from}::timestamptz` : tx``}
        ${f.occurred_to ? tx`and occurred_at <= ${f.occurred_to}::timestamptz` : tx``}
        ${f.after ? tx`and (occurred_at, id) < (${f.after.at}::timestamptz, ${f.after.id}::text)` : tx``}
      order by occurred_at desc, id desc
      limit ${f.limit}`;
    return rows.map(toRecord);
  }

  async occurrenceRecords(taskIds: string[], from: string, to: string) {
    if (!taskIds.length) return [];
    const tx = this.tx;
    return await tx<{ task_id: string; id: string; occurrence_on: string }[]>`
      select task_id, id, occurrence_on::text as occurrence_on from app.records
      where task_id in ${tx(taskIds)} and occurrence_on between ${from} and ${to}
      order by task_id, occurrence_on, occurred_at, id`;
  }

  async insertRecord(record: NewRecord) {
    const tx = this.tx;
    const values: Record<string, unknown> = {
      workspace_id: requireWorkspaceActor(this.actor).workspaceId,
      body: record.body,
      task_id: record.task_id,
      occurrence_on: record.occurrence_on,
      record_kind: "result",
    };
    if (record.occurred_at) values.occurred_at = record.occurred_at;
    const row = await insertWithIdRetry(() =>
      tx`insert into app.records ${tx(values)} on conflict (id) do nothing returning id`
    );
    return (await this.getRecord(row.id as string))!;
  }

  async updateRecord(id: string, changes: RecordChanges) {
    const tx = this.tx;
    const values = {
      ...pick(tx, changes, RECORD_WRITABLE),
      ...await this.entityLinks.recordSelection(changes.entity_ids, id),
    };
    if (changes.tag_ids !== undefined) await setTagLinks(tx, this.actor, "record", id, changes.tag_ids);
    if (
      Object.keys(values).length === 0 && changes.tag_ids === undefined
    ) {
      throw new AppError("invalid_input", "바꿀 필드가 없습니다");
    }
    const [row] = Object.keys(values).length
      ? await tx`update app.records set ${tx(values)}, version=version+1, updated_at=now()
          where id=${id} returning ${recordColumns(tx)}`
      : await tx`update app.records set version=version+1, updated_at=now()
          where id=${id} returning ${recordColumns(tx)}`;
    if (!row) throw new AppError("not_found", "항목을 찾을 수 없습니다");
    return toRecord(row);
  }

  async deleteRecord(id: string) {
    await this.tx`delete from app.records where id = ${id}`;
  }

  async detachRecords(taskId: string) {
    await this.tx`
      update app.records set task_id = null, occurrence_on = null, version = version + 1, updated_at = now()
      where task_id = ${taskId}`;
  }

  async taskWithResult(recordId: string) {
    const [row] = await this.tx`
      select ${taskColumns(this.tx)} from app.tasks where result_record_id = ${recordId} for update`;
    return row ? toTask(row) : null;
  }
}

export class SqlUnitOfWork implements UnitOfWork {
  constructor(private readonly sql: postgres.Sql) {}

  run<T>(a: Actor, fn: (store: ActivityStore) => Promise<T>, entry?: ActivityEntry): Promise<T> {
    const actor = requireWorkspaceActor(a);
    const requirements = entry?.access === "write"
      ? [{ target_kind: "tasks" as const, target_id: "*", access: "write" as const }]
      : [];
    return runInWorkspace(
      this.sql,
      actor,
      { mode: "business", requirements },
      (tx) => fn(new SqlActivityStore(tx, actor)),
    );
  }
}

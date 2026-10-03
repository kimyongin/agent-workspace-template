// Postgres 직접 연결 저장 어댑터. 트랜잭션마다 검증된 Actor 문맥을 넣고 app_user로 전환한다.
// 방식: docs/architecture/hexagonal-review.md "권한과 직접 접근"(T02-1 실험 1에서 채택).
import type postgres from "postgres";
import type { NewTask, Task } from "../../core/activity/domain.ts";
import type {
  ActivityRecord,
  ActivityStore,
  NewRecord,
  RecordChanges,
  RecordFilter,
  TaskFilter,
  UnitOfWork,
} from "../../core/activity/ports.ts";
import type { Actor } from "../../core/shared/actor.ts";
import { runAsActor, SqlActorStore } from "./sql-context.ts";
import { AppError } from "../../core/shared/errors.ts";

type Tx = postgres.TransactionSql;
type Row = Record<string, unknown>;

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v === null ? null : String(v));

function toTask(r: Row): Task {
  return {
    id: r.id as string,
    kind: r.kind as Task["kind"],
    title: r.title as string,
    summary: r.summary as string,
    body: r.body as string,
    due_on: (r.due_on as string | null) ?? null,
    recurrence: (r.recurrence as Task["recurrence"]) ?? null,
    timezone: (r.timezone as string | null) ?? null,
    status: r.status as Task["status"],
    completed_at: iso(r.completed_at),
    result_record_id: (r.result_record_id as string | null) ?? null,
    pauses: (r.pauses as Task["pauses"]) ?? [],
    version: r.version as number,
    created_at: iso(r.created_at)!,
    updated_at: iso(r.updated_at)!,
  };
}

function toRecord(r: Row): ActivityRecord {
  return {
    id: r.id as string,
    title: r.title as string,
    summary: r.summary as string,
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
  tx`id, kind, title, summary, body, due_on::text as due_on, recurrence, timezone, status, completed_at,
     result_record_id, pauses, version, created_at, updated_at`;
const recordColumns = (tx: Tx) =>
  tx`id, title, summary, body, occurred_at, task_id, occurrence_on::text as occurrence_on, version, created_at, updated_at`;

/** 수정 가능한 컬럼의 허용 목록. 이 밖의 키는 SQL로 가지 않는다. */
const TASK_WRITABLE = [
  "title",
  "summary",
  "body",
  "due_on",
  "recurrence",
  "timezone",
  "status",
  "completed_at",
  "result_record_id",
  "pauses",
] as const;
const RECORD_WRITABLE = ["title", "summary", "body", "occurred_at"] as const;

function pick<T extends Record<string, unknown>>(tx: Tx, values: T, allowed: readonly string[]) {
  const out: Record<string, unknown> = {};
  for (const key of allowed) {
    if (!(key in values) || values[key] === undefined) continue;
    const v = values[key];
    out[key] = key === "recurrence" || key === "pauses" ? (v === null ? null : tx.json(v as never)) : v;
  }
  return out;
}

class SqlActivityStore extends SqlActorStore implements ActivityStore {
  async getTask(id: string, opts: { forUpdate?: boolean } = {}) {
    const [row] = await this.tx`
      select ${taskColumns(this.tx)} from app.tasks where id = ${id}
      ${opts.forUpdate ? this.tx`for update` : this.tx``}`;
    return row ? toTask(row) : null;
  }

  async listTasks(f: TaskFilter) {
    const tx = this.tx;
    const rows = await tx`
      select ${taskColumns(tx)} from app.tasks
      where true
        ${f.kind ? tx`and kind = ${f.kind}` : tx``}
        ${f.status ? tx`and status = ${f.status}` : tx``}
        ${f.due_from ? tx`and due_on >= ${f.due_from}` : tx``}
        ${f.due_to ? tx`and due_on <= ${f.due_to}` : tx``}
        ${f.after ? tx`and (updated_at, id) < (${f.after.at}::timestamptz, ${f.after.id}::uuid)` : tx``}
      order by updated_at desc, id desc
      limit ${f.limit}`;
    return rows.map(toTask);
  }

  async insertTask(task: NewTask) {
    const tx = this.tx;
    const values = { owner_id: this.actor.userId, kind: task.kind, ...pick(tx, task, TASK_WRITABLE) };
    const [row] = await tx`insert into app.tasks ${tx(values)} returning ${taskColumns(tx)}`;
    return toTask(row);
  }

  async updateTask(id: string, changes: Partial<Task>) {
    const tx = this.tx;
    const values = pick(tx, changes, TASK_WRITABLE);
    if (Object.keys(values).length === 0) throw new AppError("invalid_input", "바꿀 필드가 없습니다");
    // set 도우미는 바로 앞의 `set` 문맥이 필요하므로 같은 템플릿에 둔다.
    const [row] = await tx`
      update app.tasks set ${tx(values)}, version = version + 1, updated_at = now()
      where id = ${id} returning ${taskColumns(tx)}`;
    if (!row) throw new AppError("not_found", "항목을 찾을 수 없습니다");
    return toTask(row);
  }

  async deleteTask(id: string) {
    await this.tx`delete from app.tasks where id = ${id}`;
  }

  async getRecord(id: string, opts: { forUpdate?: boolean } = {}) {
    const [row] = await this.tx`
      select ${recordColumns(this.tx)} from app.records where id = ${id}
      ${opts.forUpdate ? this.tx`for update` : this.tx``}`;
    return row ? toRecord(row) : null;
  }

  async getRecordSummaries(ids: string[]) {
    if (ids.length === 0) return [];
    return await this.tx<{ id: string; title: string; summary: string }[]>`
      select id, title, summary from app.records where id in ${this.tx(ids)}`;
  }

  async listRecords(f: RecordFilter) {
    const tx = this.tx;
    const rows = await tx`
      select ${recordColumns(tx)} from app.records
      where true
        ${f.task_id ? tx`and task_id = ${f.task_id}` : tx``}
        ${f.occurred_from ? tx`and occurred_at >= ${f.occurred_from}::timestamptz` : tx``}
        ${f.occurred_to ? tx`and occurred_at <= ${f.occurred_to}::timestamptz` : tx``}
        ${f.after ? tx`and (occurred_at, id) < (${f.after.at}::timestamptz, ${f.after.id}::uuid)` : tx``}
      order by occurred_at desc, id desc
      limit ${f.limit}`;
    return rows.map(toRecord);
  }

  async occurrenceRecords(taskId: string, from: string, to: string) {
    return await this.tx<{ id: string; occurrence_on: string }[]>`
      select id, occurrence_on::text as occurrence_on from app.records
      where task_id = ${taskId} and occurrence_on between ${from} and ${to}
      order by occurrence_on, occurred_at, id`;
  }

  async insertRecord(record: NewRecord) {
    const tx = this.tx;
    const values: Record<string, unknown> = {
      owner_id: this.actor.userId,
      title: record.title,
      summary: record.summary,
      body: record.body,
      task_id: record.task_id,
      occurrence_on: record.occurrence_on,
    };
    if (record.occurred_at) values.occurred_at = record.occurred_at;
    const [row] = await tx`insert into app.records ${tx(values)} returning ${recordColumns(tx)}`;
    return toRecord(row);
  }

  async updateRecord(id: string, changes: RecordChanges) {
    const tx = this.tx;
    const values = pick(tx, changes, RECORD_WRITABLE);
    if (Object.keys(values).length === 0) throw new AppError("invalid_input", "바꿀 필드가 없습니다");
    const [row] = await tx`
      update app.records set ${tx(values)}, version = version + 1, updated_at = now()
      where id = ${id} returning ${recordColumns(tx)}`;
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

  run<T>(actor: Actor, fn: (store: ActivityStore) => Promise<T>): Promise<T> {
    return runAsActor(this.sql, actor, (tx) => fn(new SqlActivityStore(tx, actor)));
  }
}

// 할 일·기록 유스케이스. HTTP와 MCP가 같은 함수를 호출한다(ADR-0001).
// 읽기 → 도메인 판단 → 저장 순서와 트랜잭션 경계, 색인 작업 등록, 요청 재전송 처리를 맡는다.
import type { RecordCreate, RecordListQuery, RecordResult, RecordUpdate } from "../../contracts/record.ts";
import type {
  Occurrence,
  TaskComplete,
  TaskCreate,
  TaskDetail,
  TaskListItem,
  TaskListQuery,
  TaskResult,
  TaskUpdate,
} from "../../contracts/task.ts";
import type { Actor } from "../shared/actor.ts";
import { conflict, notFound } from "../shared/errors.ts";
import { decodeCursor, once, type Page, paginate, scopeOf, searchInputHash } from "../shared/operations.ts";
import {
  assertRecordableOccurrence,
  assertVersion,
  completeTask as decideComplete,
  newTask,
  resumeTask as decideResume,
  stopTask as decideStop,
  type Task,
  todayOf,
  updateTask as decideUpdate,
} from "./domain.ts";
import type { ActivityRecord, ActivityStore, Clock, UnitOfWork } from "./ports.ts";
import { isOccurrence, listOccurrences as computeOccurrences, occurrenceStatus } from "./recurrence.ts";

export interface ActivityDeps {
  uow: UnitOfWork;
  clock: Clock;
}

export type { Page } from "../shared/operations.ts";

function toTaskResult(task: Task): TaskResult {
  return { ...task };
}

function toRecordResult(record: ActivityRecord): RecordResult {
  return { ...record };
}

async function requireTask(store: ActivityStore, id: string, forUpdate = false): Promise<Task> {
  const task = await store.getTask(id, { forUpdate });
  if (!task) throw notFound();
  return task;
}

async function requireRecord(store: ActivityStore, id: string, forUpdate = false): Promise<ActivityRecord> {
  const record = await store.getRecord(id, { forUpdate });
  if (!record) throw notFound();
  return record;
}

// ---------- 할 일 ----------

export async function createTask(deps: ActivityDeps, actor: Actor, input: TaskCreate): Promise<TaskResult> {
  return await deps.uow.run(actor, (store) =>
    once(store, "create_task", input.request_id, input, async () => {
      const task = await store.insertTask(newTask(input));
      await store.enqueueIndex({ kind: "task", id: task.id, input_hash: await searchInputHash(task) });
      return toTaskResult(task);
    }));
}

export async function getTask(deps: ActivityDeps, actor: Actor, id: string): Promise<TaskDetail> {
  return await deps.uow.run(actor, async (store) => {
    const task = await requireTask(store, id);
    const [result] = task.result_record_id ? await store.getRecordSummaries([task.result_record_id]) : [];
    return { ...toTaskResult(task), result_record: result ?? null };
  });
}

export async function listTasks(deps: ActivityDeps, actor: Actor, query: TaskListQuery): Promise<Page<TaskListItem>> {
  const { cursor, limit, ...filter } = query;
  const scope = await scopeOf(actor, { list: "tasks", ...filter });
  const after = cursor ? decodeCursor(cursor, scope) : undefined;
  const now = deps.clock.now();

  return await deps.uow.run(actor, async (store) => {
    if (!filter.occurrence_on) {
      const rows = await store.listTasks({ ...filter, after, limit: limit + 1 });
      const page = await paginate(rows, limit, (t) => t.updated_at, scope);
      return { ...page, items: page.items.map((t) => ({ ...toTaskResult(t), occurrence: null })) };
    }

    // 그 날짜에 회차가 있는 반복 할 일. 회차는 계산값이라 반복 할 일을 모두 읽어 거른다(개인 앱 규모).
    const date = filter.occurrence_on;
    if (filter.kind === "once") return { items: [], next_cursor: null };
    const candidates = await store.listTasks({
      kind: "recurring",
      status: filter.status,
      tag_id: filter.tag_id,
      limit: 5000,
    });
    const items: TaskListItem[] = [];
    for (const task of candidates) {
      if (!task.recurrence) continue;
      const records = await store.occurrenceRecords(task.id, date, date);
      const inRule = isOccurrence(task.recurrence, task.pauses, date);
      if (!inRule && records.length === 0) continue;
      const occurrence: Occurrence = {
        date,
        status: occurrenceStatus(date, todayOf(task, now), records.length),
        record_ids: records.map((r) => r.id),
        in_rule: inRule,
      };
      items.push({ ...toTaskResult(task), occurrence });
    }
    const sorted = items
      .filter((t) => !after || t.updated_at < after.at || (t.updated_at === after.at && t.id < after.id))
      .sort((x, y) => (x.updated_at === y.updated_at ? (x.id < y.id ? 1 : -1) : x.updated_at < y.updated_at ? 1 : -1));
    return await paginate(sorted, limit, (t) => t.updated_at, scope);
  });
}

export async function updateTask(deps: ActivityDeps, actor: Actor, id: string, patch: TaskUpdate): Promise<TaskResult> {
  return await deps.uow.run(actor, async (store) => {
    const task = await requireTask(store, id, true);
    const changes = decideUpdate(task, patch);
    const updated = await store.updateTask(id, changes);
    if (updated.title !== task.title || updated.summary !== task.summary) {
      await store.enqueueIndex({ kind: "task", id, input_hash: await searchInputHash(updated) });
    }
    return toTaskResult(updated);
  });
}

/** 일회성 완료: 할 일 done, 결과 기록 생성, 기록 색인 등록을 한 트랜잭션으로. */
export async function completeTask(
  deps: ActivityDeps,
  actor: Actor,
  id: string,
  input: TaskComplete,
): Promise<{ task: TaskResult; record: RecordResult }> {
  return await deps.uow.run(actor, (store) =>
    once(store, `complete_task:${id}`, input.request_id, input, async () => {
      const now = deps.clock.now();
      const task = await requireTask(store, id, true);
      const decided = decideComplete(task, input.expected_version, now);
      const record = await store.insertRecord({
        title: input.title,
        summary: input.summary,
        body: input.body,
        occurred_at: input.occurred_at ?? null,
        task_id: task.id,
        occurrence_on: null,
        applied_principle_ids: input.applied_principle_ids,
      });
      const updated = await store.updateTask(id, { ...decided, result_record_id: record.id });
      await store.enqueueIndex({ kind: "record", id: record.id, input_hash: await searchInputHash(record) });
      return { task: toTaskResult(updated), record: toRecordResult(record) };
    }));
}

/** 할 일만 삭제한다. 결과·회차 기록은 보존하고 task_id·occurrence_on을 비운다. */
export async function deleteTask(deps: ActivityDeps, actor: Actor, id: string, expectedVersion: number): Promise<void> {
  await deps.uow.run(actor, async (store) => {
    const task = await requireTask(store, id, true);
    assertVersion(task, expectedVersion);
    await store.detachRecords(id);
    await store.deleteTask(id);
  });
}

export async function stopTask(deps: ActivityDeps, actor: Actor, id: string, expectedVersion: number) {
  return await deps.uow.run(actor, async (store) => {
    const task = await requireTask(store, id, true);
    return toTaskResult(await store.updateTask(id, decideStop(task, expectedVersion, deps.clock.now())));
  });
}

export async function resumeTask(deps: ActivityDeps, actor: Actor, id: string, expectedVersion: number) {
  return await deps.uow.run(actor, async (store) => {
    const task = await requireTask(store, id, true);
    return toTaskResult(await store.updateTask(id, decideResume(task, expectedVersion, deps.clock.now())));
  });
}

export async function listOccurrences(
  deps: ActivityDeps,
  actor: Actor,
  id: string,
  range: { from: string; to: string },
) {
  return await deps.uow.run(actor, async (store) => {
    const task = await requireTask(store, id);
    if (task.kind !== "recurring" || !task.recurrence) throw conflict("반복 할 일에만 회차가 있습니다");
    const today = todayOf(task, deps.clock.now());
    const records = await store.occurrenceRecords(id, range.from, range.to);
    const items = computeOccurrences(task.recurrence, task.pauses, records, range.from, range.to, today);
    return { task_id: id, from: range.from, to: range.to, today, items };
  });
}

/** 반복 할 일의 회차에 기록을 남긴다. 기록 생성과 색인 등록은 한 트랜잭션. 한 회차에 여러 번 가능. */
export async function recordOccurrence(
  deps: ActivityDeps,
  actor: Actor,
  id: string,
  date: string,
  input: RecordCreate,
): Promise<RecordResult> {
  return await deps.uow.run(
    actor,
    (store) =>
      once(store, `record_occurrence:${id}:${date}`, input.request_id, input, async () => {
        // 중단·규칙 수정과 겹치지 않도록 할 일을 잠그고 판단한다.
        const task = await requireTask(store, id, true);
        assertRecordableOccurrence(task, date, deps.clock.now());
        const record = await store.insertRecord({
          title: input.title,
          summary: input.summary,
          body: input.body,
          occurred_at: input.occurred_at ?? null,
          task_id: id,
          occurrence_on: date,
          applied_principle_ids: input.applied_principle_ids,
        });
        await store.enqueueIndex({ kind: "record", id: record.id, input_hash: await searchInputHash(record) });
        return toRecordResult(record);
      }),
  );
}

// ---------- 기록 ----------

export async function createRecord(deps: ActivityDeps, actor: Actor, input: RecordCreate): Promise<RecordResult> {
  return await deps.uow.run(actor, (store) =>
    once(store, "create_record", input.request_id, input, async () => {
      const record = await store.insertRecord({
        title: input.title,
        summary: input.summary,
        body: input.body,
        occurred_at: input.occurred_at ?? null,
        task_id: null,
        occurrence_on: null,
        applied_principle_ids: input.applied_principle_ids,
      });
      await store.enqueueIndex({ kind: "record", id: record.id, input_hash: await searchInputHash(record) });
      return toRecordResult(record);
    }));
}

export async function getRecord(deps: ActivityDeps, actor: Actor, id: string): Promise<RecordResult> {
  return await deps.uow.run(actor, async (store) => toRecordResult(await requireRecord(store, id)));
}

export async function listRecords(
  deps: ActivityDeps,
  actor: Actor,
  query: RecordListQuery,
): Promise<Page<RecordResult>> {
  const { cursor, limit, ...filter } = query;
  const scope = await scopeOf(actor, { list: "records", ...filter });
  const after = cursor ? decodeCursor(cursor, scope) : undefined;
  return await deps.uow.run(actor, async (store) => {
    const rows = await store.listRecords({ ...filter, after, limit: limit + 1 });
    const page = await paginate(rows, limit, (r) => r.occurred_at, scope);
    return { ...page, items: page.items.map(toRecordResult) };
  });
}

/** 제목·요약이 바뀌면 재색인, 본문만 바뀌면 재임베딩하지 않는다. */
export async function updateRecord(
  deps: ActivityDeps,
  actor: Actor,
  id: string,
  patch: RecordUpdate,
): Promise<RecordResult> {
  return await deps.uow.run(actor, async (store) => {
    const record = await requireRecord(store, id, true);
    assertVersion(record, patch.expected_version);
    const { expected_version: _v, ...changes } = patch;
    const updated = await store.updateRecord(id, changes);
    if (updated.title !== record.title || updated.summary !== record.summary) {
      await store.enqueueIndex({ kind: "record", id, input_hash: await searchInputHash(updated) });
    }
    return toRecordResult(updated);
  });
}

/**
 * 기록 삭제. 일회성 할 일의 결과였다면 할 일은 done을 유지하고 result_record_id만 비운다.
 * 회차 기록이면 그 회차의 상태는 남은 기록으로 다시 계산된다.
 */
export async function deleteRecord(deps: ActivityDeps, actor: Actor, id: string, expectedVersion: number) {
  await deps.uow.run(actor, async (store) => {
    const record = await requireRecord(store, id, true);
    assertVersion(record, expectedVersion);
    const owner = await store.taskWithResult(id);
    if (owner) await store.updateTask(owner.id, { result_record_id: null });
    await store.deleteRecord(id);
  });
}

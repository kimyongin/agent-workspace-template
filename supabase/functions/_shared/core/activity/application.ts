import { activityChangeTarget, recordChangeFacts, taskChangeFacts } from "./change.ts";
import { entityChanges, selectedEntities } from "./entity-selection.ts";
// 할 일·기록 유스케이스. HTTP와 MCP가 같은 함수를 호출한다(ADR-0001).
// 읽기 → 도메인 판단 → 저장 순서와 트랜잭션 경계, 색인 작업 등록, 요청 재전송 처리를 맡는다.
import type { RecordCreate, RecordListQuery, RecordResult, RecordUpdate } from "../../contracts/record.ts";
import type {
  TaskComplete,
  TaskCreate,
  TaskDetail,
  TaskListItem,
  TaskListQuery,
  TaskResult,
  TaskUpdate,
} from "../../contracts/task.ts";
import type { Actor } from "../shared/actor.ts";
import { conflict, invalidInput, notFound } from "../shared/errors.ts";
import { changed } from "../shared/changes.ts";
import { decodeCursor, type Page, paginate, scopeOf, searchInputHash } from "../shared/operations.ts";
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
import { listOccurrences as computeOccurrences } from "./recurrence.ts";

export interface ActivityDeps {
  uow: UnitOfWork;
  clock: Clock;
}

export type { Page } from "../shared/operations.ts";

function toTaskResult(task: Task): TaskResult {
  return {
    ...task,
    entity_ids: selectedEntities(task) ?? [],
    entity_context: task.entity_context ?? [],
  };
}

function toRecordResult(record: ActivityRecord): RecordResult {
  return {
    ...record,
    entity_ids: selectedEntities(record) ?? [],
    entity_context: record.entity_context ?? [],
    record_kind: record.record_kind ?? "user",
    change: record.change ?? null,
    applied_principle_snapshots: record.applied_principle_snapshots ?? [],
  };
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
  return await deps.uow.run(actor, async (store) => {
    const task = await store.insertTask(newTask(input));

    await store.appendChange({
      target_kind: "task",
      target: activityChangeTarget(task),
      action: "create",
      before: null,
      after: taskChangeFacts(task),
      change_note: input.change_note,
      change_tag_ids: input.change_tag_ids,
    });
    return toTaskResult(task);
  });
}

export async function getTask(deps: ActivityDeps, actor: Actor, id: string): Promise<TaskDetail> {
  return await deps.uow.run(actor, async (store) => {
    const task = await requireTask(store, id);
    const [result] = task.result_record_id ? await store.getRecordBodies([task.result_record_id]) : [];
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
      tag_ids: filter.tag_ids,
      entity_id: filter.entity_id,
      keyword: filter.keyword,
      limit: 5000,
    });
    const records = await store.occurrenceRecords(
      candidates.filter((task) => task.recurrence).map((task) => task.id),
      date,
      date,
    );
    const byTask = new Map<string, typeof records>();
    for (const record of records) {
      const group = byTask.get(record.task_id);
      if (group) group.push(record);
      else byTask.set(record.task_id, [record]);
    }
    const items: TaskListItem[] = [];
    for (const task of candidates) {
      if (!task.recurrence) continue;
      const [occurrence] = computeOccurrences(
        task.recurrence,
        task.pauses,
        byTask.get(task.id) ?? [],
        date,
        date,
        todayOf(task, now),
      );
      if (occurrence) items.push({ ...toTaskResult(task), occurrence });
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
    if (!changed(task, changes)) return toTaskResult(task);
    const updated = await store.updateTask(id, changes);
    await store.appendChange({
      target_kind: "task",
      target: activityChangeTarget(updated),
      action: "update",
      before: taskChangeFacts(task),
      after: taskChangeFacts(updated),
      change_note: patch.change_note,
      change_tag_ids: patch.change_tag_ids,
    });
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
  return await deps.uow.run(actor, async (store) => {
    const now = deps.clock.now();
    const task = await requireTask(store, id, true);
    const decided = decideComplete(task, input.expected_version, now);
    const record = await store.insertRecord({
      record_kind: "result",
      ...entityChanges({ entity_ids: selectedEntities(task) ?? [] }),
      body: input.body,
      occurred_at: input.occurred_at ?? null,
      task_id: task.id,
      occurrence_on: null,
      tag_ids: input.tag_ids,
    });
    const updated = await store.updateTask(id, { ...decided, result_record_id: record.id });
    await store.enqueueIndex({ kind: "record", id: record.id, input_hash: await searchInputHash(record.body) });
    return { task: toTaskResult(updated), record: toRecordResult(record) };
  });
}

/** 할 일만 삭제한다. 결과·회차 기록은 보존하고 task_id·occurrence_on을 비운다. */
export async function deleteTask(
  deps: ActivityDeps,
  actor: Actor,
  id: string,
  expectedVersion: number,
  change_note?: string,
  change_tag_ids?: string[],
): Promise<void> {
  await deps.uow.run(
    actor,
    async (store) => {
      const task = await requireTask(store, id, true);
      assertVersion(task, expectedVersion);
      await store.detachRecords(id);
      await store.deleteTask(id);
      await store.appendChange({
        target_kind: "task",
        target: activityChangeTarget(task),
        action: "delete",
        before: taskChangeFacts(task),
        after: null,
        change_note,
        change_tag_ids,
      });
      return { deleted: true };
    },
  );
}

export async function stopTask(
  deps: ActivityDeps,
  actor: Actor,
  id: string,
  expectedVersion: number,
  change_note?: string,
  change_tag_ids?: string[],
) {
  return await deps.uow.run(
    actor,
    async (store) => {
      const task = await requireTask(store, id, true);
      const result = await store.updateTask(id, decideStop(task, expectedVersion, deps.clock.now()));
      await store.appendChange({
        target_kind: "task",
        target: activityChangeTarget(result),
        action: "stop",
        before: taskChangeFacts(task),
        after: taskChangeFacts(result),
        change_note,
        change_tag_ids,
      });
      return toTaskResult(result);
    },
  );
}

export async function resumeTask(
  deps: ActivityDeps,
  actor: Actor,
  id: string,
  expectedVersion: number,
  change_note?: string,
  change_tag_ids?: string[],
) {
  return await deps.uow.run(
    actor,
    async (store) => {
      const task = await requireTask(store, id, true);
      const result = await store.updateTask(id, decideResume(task, expectedVersion, deps.clock.now()));
      await store.appendChange({
        target_kind: "task",
        target: activityChangeTarget(result),
        action: "resume",
        before: taskChangeFacts(task),
        after: taskChangeFacts(result),
        change_note,
        change_tag_ids,
      });
      return toTaskResult(result);
    },
  );
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
    const records = await store.occurrenceRecords([id], range.from, range.to);
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
  input: Omit<RecordCreate, "task_id">,
): Promise<RecordResult> {
  return await deps.uow.run(
    actor,
    async (store) => {
      // 중단·규칙 수정과 겹치지 않도록 할 일을 잠그고 판단한다.
      const task = await requireTask(store, id, true);
      assertRecordableOccurrence(task, date, deps.clock.now());
      const record = await store.insertRecord({
        id: input.id,
        record_kind: "result",
        ...entityChanges({ entity_ids: selectedEntities(input) ?? selectedEntities(task) ?? [] }),
        body: input.body,
        occurred_at: input.occurred_at ?? null,
        task_id: id,
        occurrence_on: date,
        tag_ids: input.tag_ids,
      });
      await store.enqueueIndex({ kind: "record", id: record.id, input_hash: await searchInputHash(record.body) });
      return toRecordResult(record);
    },
  );
}

// ---------- 기록 ----------

export async function createRecord(deps: ActivityDeps, actor: Actor, input: RecordCreate): Promise<RecordResult> {
  return await deps.uow.run(actor, async (store) => {
    const task = input.task_id ? await requireTask(store, input.task_id, true) : null;
    const record = await store.insertRecord({
      id: input.id,
      ...entityChanges({ entity_ids: selectedEntities(input) ?? (task ? selectedEntities(task) : []) ?? [] }),
      body: input.body,
      occurred_at: input.occurred_at ?? null,
      task_id: task?.id ?? null,
      occurrence_on: null,
      tag_ids: input.tag_ids,
    });
    await store.enqueueIndex({ kind: "record", id: record.id, input_hash: await searchInputHash(record.body) });
    return toRecordResult(record);
  });
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

/** 본문 변경만 구간 색인을 교체한다. */
export async function updateRecord(
  deps: ActivityDeps,
  actor: Actor,
  id: string,
  patch: RecordUpdate,
): Promise<RecordResult> {
  return await deps.uow.run(actor, async (store) => {
    const record = await requireRecord(store, id, true);
    assertVersion(record, patch.expected_version);
    if (
      record.record_kind === "change" &&
      ["entity_ids", "tag_ids", "occurred_at"].some((k) => k in patch)
    ) {
      throw invalidInput("변경 기록은 본문만 정정할 수 있습니다");
    }
    const { expected_version: _v, ...content } = patch;
    const selection = entityChanges(content);
    const changes = { ...content, ...selection };
    if (
      !changed(record, changes)
    ) return toRecordResult(record);
    const updated = await store.updateRecord(id, {
      ...changes,
    });
    if (updated.body !== record.body) {
      await store.enqueueIndex({ kind: "record", id, input_hash: await searchInputHash(updated.body) });
    }
    // Records are editable knowledge. Editing their memo does not create another event.
    return toRecordResult(updated);
  });
}

/**
 * 기록 삭제. 일회성 할 일의 결과였다면 할 일은 done을 유지하고 result_record_id만 비운다.
 * 회차 기록이면 그 회차의 상태는 남은 기록으로 다시 계산된다.
 */
export async function deleteRecord(
  deps: ActivityDeps,
  actor: Actor,
  id: string,
  expectedVersion: number,
  change_note?: string,
  change_tag_ids?: string[],
) {
  await deps.uow.run(
    actor,
    async (store) => {
      const record = await requireRecord(store, id, true);
      assertVersion(record, expectedVersion);
      const owner = await store.taskWithResult(id);
      if (owner) await store.updateTask(owner.id, { result_record_id: null });
      await store.deleteRecord(id);
      await store.appendChange({
        target_kind: "record",
        target: activityChangeTarget(record),
        action: "delete",
        before: recordChangeFacts(record),
        after: null,
        change_note,
        change_tag_ids,
      });
      return { deleted: true };
    },
  );
}

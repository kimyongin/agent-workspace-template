import { activityChangeTarget, recordChangeFacts, taskChangeFacts } from "./change.ts";
import { entityChanges, selectedEntities } from "./entity-selection.ts";
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
import { conflict, invalidInput, notFound } from "../shared/errors.ts";
import { changed } from "../shared/changes.ts";
import type { ChangeMemo } from "../../contracts/change.ts";
import { basicChangeMemo } from "../shared/change-memo.ts";
import type { TaskChangePreview } from "../../contracts/task-change.ts";
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
    change_note: record.change_note ?? null,
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
export async function previewTaskChange(deps: ActivityDeps, actor: Actor, input: TaskChangePreview) {
  return await deps.uow.run(actor, async (store) => {
    if (input.action === "create") {
      const task = newTask(input.input as TaskCreate);
      const ids = selectedEntities(input.input as TaskCreate) ?? [];
      if (ids.length) await store.validateEntitySelection(ids);
      return {
        memo: basicChangeMemo({
          action: "create",
          target_title: task.title,
          before: null,
          after: taskChangeFacts(task),
          change_note: input.input.change_note,
        }),
        changed: true,
      };
    }
    const task = await requireTask(store, input.id);
    assertVersion(task, input.input.expected_version as number);
    const now = deps.clock.now();
    if (input.action === "complete" || input.action === "occurrence") {
      if (input.action === "complete") decideComplete(task, input.input.expected_version as number, now);
      else assertRecordableOccurrence(task, input.date!, now);
      const title = `${Array.from(task.title).slice(0, 85).join("")} 수행 결과`;
      return {
        memo: {
          title,
          summary: title,
          body: `할 일: ${task.title}${
            input.action === "occurrence" ? `\n회차: ${input.date}` : ""
          }\n실제로 수행한 내용과 결과를 보충하세요.`,
        },
        changed: true,
      };
    }
    const after = input.action === "delete" ? null : {
      ...task,
      ...(input.action === "update"
        ? decideUpdate(task, input.input as TaskUpdate)
        : input.action === "stop"
        ? decideStop(task, input.input.expected_version as number, now)
        : decideResume(task, input.input.expected_version as number, now)),
    };
    if (input.action === "update" && changed(task, after!)) {
      const ids = selectedEntities(input.input as TaskUpdate);
      if (ids?.length) await store.validateEntitySelection(ids);
    }
    return {
      memo: basicChangeMemo({
        action: input.action as "update" | "delete" | "stop" | "resume",
        target_title: (after ?? task).title,
        before: taskChangeFacts(task),
        after: after && taskChangeFacts(after),
        change_note: input.input.change_note,
      }),
      changed: after === null || changed(task, after),
    };
  });
}

export async function createTask(deps: ActivityDeps, actor: Actor, input: TaskCreate): Promise<TaskResult> {
  return await deps.uow.run(actor, (store) =>
    once(store, "create_task", input.request_id, input, async () => {
      const task = await store.insertTask(newTask(input));
      await store.enqueueIndex({ kind: "task", id: task.id, input_hash: await searchInputHash(task) });
      await store.appendChange({
        target_kind: "task",
        target: activityChangeTarget(task),
        action: "create",
        before: null,
        after: taskChangeFacts(task),
        change_note: input.change_note,
        change_memo: input.change_memo,
      });
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
      tag_ids: filter.tag_ids,
      entity_id: filter.entity_id,
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
  return await deps.uow.run(actor, (store) =>
    once(store, `update_task:${id}`, patch.request_id, patch, async () => {
      const task = await requireTask(store, id, true);
      const changes = decideUpdate(task, patch);
      if (!changed(task, changes)) return toTaskResult(task);
      const updated = await store.updateTask(id, changes);
      if (updated.title !== task.title || updated.summary !== task.summary) {
        await store.enqueueIndex({ kind: "task", id, input_hash: await searchInputHash(updated) });
      }
      await store.appendChange({
        target_kind: "task",
        target: activityChangeTarget(updated),
        action: "update",
        before: taskChangeFacts(task),
        after: taskChangeFacts(updated),
        change_note: patch.change_note,
        change_memo: patch.change_memo,
      });
      return toTaskResult(updated);
    }));
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
        record_kind: "result",
        change_note: input.change_note,
        ...entityChanges({ entity_ids: selectedEntities(task) ?? [] }),
        title: input.title,
        summary: input.summary,
        body: input.body,
        occurred_at: input.occurred_at ?? null,
        task_id: task.id,
        occurrence_on: null,
        tag_ids: input.tag_ids,
      });
      const updated = await store.updateTask(id, { ...decided, result_record_id: record.id });
      await store.enqueueIndex({ kind: "record", id: record.id, input_hash: await searchInputHash(record) });
      return { task: toTaskResult(updated), record: toRecordResult(record) };
    }));
}

/** 할 일만 삭제한다. 결과·회차 기록은 보존하고 task_id·occurrence_on을 비운다. */
export async function deleteTask(
  deps: ActivityDeps,
  actor: Actor,
  id: string,
  expectedVersion: number,
  change_note?: string,
  request_id?: string,
  change_memo?: ChangeMemo,
): Promise<void> {
  await deps.uow.run(
    actor,
    (store) =>
      once(store, `delete_task:${id}`, request_id, { expectedVersion, change_note, change_memo }, async () => {
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
          change_memo,
        });
        return { deleted: true };
      }),
  );
}

export async function stopTask(
  deps: ActivityDeps,
  actor: Actor,
  id: string,
  expectedVersion: number,
  change_note?: string,
  request_id?: string,
  change_memo?: ChangeMemo,
) {
  return await deps.uow.run(
    actor,
    (store) =>
      once(store, `stop_task:${id}`, request_id, { expectedVersion, change_note, change_memo }, async () => {
        const task = await requireTask(store, id, true);
        const result = await store.updateTask(id, decideStop(task, expectedVersion, deps.clock.now()));
        await store.appendChange({
          target_kind: "task",
          target: activityChangeTarget(result),
          action: "stop",
          before: taskChangeFacts(task),
          after: taskChangeFacts(result),
          change_note,
          change_memo,
        });
        return toTaskResult(result);
      }),
  );
}

export async function resumeTask(
  deps: ActivityDeps,
  actor: Actor,
  id: string,
  expectedVersion: number,
  change_note?: string,
  request_id?: string,
  change_memo?: ChangeMemo,
) {
  return await deps.uow.run(
    actor,
    (store) =>
      once(store, `resume_task:${id}`, request_id, { expectedVersion, change_note, change_memo }, async () => {
        const task = await requireTask(store, id, true);
        const result = await store.updateTask(id, decideResume(task, expectedVersion, deps.clock.now()));
        await store.appendChange({
          target_kind: "task",
          target: activityChangeTarget(result),
          action: "resume",
          before: taskChangeFacts(task),
          after: taskChangeFacts(result),
          change_note,
          change_memo,
        });
        return toTaskResult(result);
      }),
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
          record_kind: "result",
          change_note: input.change_note,
          ...entityChanges({ entity_ids: selectedEntities(input) ?? selectedEntities(task) ?? [] }),
          title: input.title,
          summary: input.summary,
          body: input.body,
          occurred_at: input.occurred_at ?? null,
          task_id: id,
          occurrence_on: date,
          tag_ids: input.tag_ids,
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
        change_note: input.change_note,
        ...entityChanges({ entity_ids: selectedEntities(input) ?? [] }),
        title: input.title,
        summary: input.summary,
        body: input.body,
        occurred_at: input.occurred_at ?? null,
        task_id: null,
        occurrence_on: null,
        tag_ids: input.tag_ids,
      });
      await store.enqueueIndex({ kind: "record", id: record.id, input_hash: await searchInputHash(record) });
      await store.appendChange({
        target_kind: "record",
        target: activityChangeTarget(record),
        action: "create",
        before: null,
        after: recordChangeFacts(record),
        change_note: input.change_note,
      });
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
  return await deps.uow.run(actor, (store) =>
    once(store, `update_record:${id}`, patch.request_id, patch, async () => {
      const record = await requireRecord(store, id, true);
      assertVersion(record, patch.expected_version);
      if (
        record.record_kind === "change" &&
        ["entity_ids", "tag_ids", "occurred_at"].some((k) => k in patch)
      ) {
        throw invalidInput("변경 기록은 제목·요약·본문·메모만 정정할 수 있습니다");
      }
      const { expected_version: _v, request_id: _r, change_note, ...content } = patch;
      const selection = entityChanges(content);
      const changes = { ...content, ...selection };
      if (
        !changed(record, changes) &&
        (change_note === undefined || record.change_note === change_note)
      ) return toRecordResult(record);
      const updated = await store.updateRecord(id, {
        ...changes,
        ...(change_note === undefined ? {} : { change_note }),
      });
      if (updated.title !== record.title || updated.summary !== record.summary) {
        await store.enqueueIndex({ kind: "record", id, input_hash: await searchInputHash(updated) });
      }
      // Records are editable knowledge. Editing their memo does not create another event.
      return toRecordResult(updated);
    }));
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
  request_id?: string,
) {
  await deps.uow.run(
    actor,
    (store) =>
      once(store, `delete_record:${id}`, request_id, { expectedVersion, change_note }, async () => {
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
        });
        return { deleted: true };
      }),
  );
}

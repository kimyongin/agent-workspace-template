// 할 일·활동 기록의 업무 규칙. DB·SDK·HTTP를 모른다(ADR-0001, ADR-0003).
// 상태 전환과 완료 조건의 유일한 구현이며 SQL에 같은 판단을 두지 않는다.
import type { Recurrence, TaskCreate, TaskUpdate } from "../../contracts/task.ts";
import { AppError, conflict, invalidInput } from "../shared/errors.ts";
import { dateIn } from "../shared/dates.ts";
import { isOccurrence, type Pause } from "./recurrence.ts";

export type TaskKind = "once" | "recurring";
export type TaskStatus = "open" | "done" | "active" | "stopped";

export interface Task {
  entity_id?: string | null;
  id: string;
  kind: TaskKind;
  title: string;
  summary: string;
  body: string;
  due_on: string | null;
  recurrence: Recurrence | null;
  timezone: string | null;
  status: TaskStatus;
  completed_at: string | null;
  result_record_id: string | null;
  pauses: Pause[];
  tag_ids: string[];
  version: number;
  created_at: string;
  updated_at: string;
}

export type NewTask = Pick<
  Task,
  | "kind"
  | "title"
  | "summary"
  | "body"
  | "due_on"
  | "recurrence"
  | "timezone"
  | "status"
  | "pauses"
  | "tag_ids"
  | "entity_id"
>;

export function newTask(input: TaskCreate): NewTask {
  const common = {
    entity_id: input.entity_id ?? null,
    title: input.title,
    summary: input.summary,
    body: input.body,
    pauses: [],
    tag_ids: input.tag_ids ?? [],
  };
  if (input.kind === "once") {
    return { ...common, kind: "once", due_on: input.due_on ?? null, recurrence: null, timezone: null, status: "open" };
  }
  return {
    ...common,
    kind: "recurring",
    due_on: null,
    recurrence: input.recurrence,
    timezone: input.timezone,
    status: "active",
  };
}

export function assertVersion(current: { version: number }, expected: number): void {
  if (current.version !== expected) {
    throw conflict(`다른 변경이 먼저 저장되었습니다(현재 버전 ${current.version}). 다시 조회한 뒤 시도하세요`);
  }
}

export type TaskChanges = Partial<
  Pick<Task, "title" | "summary" | "body" | "due_on" | "recurrence" | "timezone" | "tag_ids" | "entity_id">
>;

/** 내용 필드만 바꾼다. 완료된 할 일도 수정할 수 있다. 종류에 맞지 않는 필드는 거부한다. */
export function updateTask(task: Task, patch: TaskUpdate): TaskChanges {
  assertVersion(task, patch.expected_version);
  const { expected_version: _v, change_note: _note, change_memo: _memo, request_id: _request, ...changes } = patch;
  if (task.kind === "once" && (changes.recurrence !== undefined || changes.timezone !== undefined)) {
    throw invalidInput("일회성 할 일에는 반복 규칙과 시간대가 없습니다", [
      {
        path: changes.recurrence !== undefined ? "recurrence" : "timezone",
        message: "일회성 할 일에서 쓸 수 없습니다",
      },
    ]);
  }
  if (task.kind === "recurring" && changes.due_on !== undefined) {
    throw invalidInput("반복 할 일에는 기한이 없습니다", [{
      path: "due_on",
      message: "반복 할 일에서 쓸 수 없습니다",
    }]);
  }
  return changes;
}

/** 일회성 할 일 완료 판단. 저장(할 일 상태·결과 기록·색인 등록)은 application이 한 트랜잭션으로 한다. */
export function completeTask(task: Task, expectedVersion: number, now: Date): Pick<Task, "status" | "completed_at"> {
  if (task.kind !== "once") throw conflict("반복 할 일은 완료하지 않습니다. 회차에 기록을 남기세요");
  assertVersion(task, expectedVersion);
  if (task.status !== "open") throw conflict("이미 완료된 할 일입니다");
  return { status: "done", completed_at: now.toISOString() };
}

function requireRecurring(task: Task): asserts task is Task & { recurrence: Recurrence; timezone: string } {
  if (task.kind !== "recurring" || !task.recurrence || !task.timezone) {
    throw conflict("반복 할 일에만 할 수 있습니다");
  }
}

export function todayOf(task: Task, now: Date): string {
  requireRecurring(task);
  return dateIn(task.timezone, now);
}

/** 중단: active에서만. 오늘(할 일의 시간대)부터 회차가 없다. 기존 기록은 유지한다. */
export function stopTask(task: Task, expectedVersion: number, now: Date): Pick<Task, "status" | "pauses"> {
  requireRecurring(task);
  assertVersion(task, expectedVersion);
  if (task.status !== "active") throw conflict("반복 중인 할 일만 중단할 수 있습니다");
  const today = dateIn(task.timezone, now);
  const last = task.pauses.at(-1);
  // 같은 날 재개했다가 다시 중단하면 그 중단을 이어 간다.
  if (last && last.resumed_on === today) {
    return {
      status: "stopped",
      pauses: [...task.pauses.slice(0, -1), { stopped_on: last.stopped_on, resumed_on: null }],
    };
  }
  return { status: "stopped", pauses: [...task.pauses, { stopped_on: today, resumed_on: null }] };
}

/** 재개: stopped에서만. 재개일부터 회차가 다시 생긴다. */
export function resumeTask(task: Task, expectedVersion: number, now: Date): Pick<Task, "status" | "pauses"> {
  requireRecurring(task);
  assertVersion(task, expectedVersion);
  if (task.status !== "stopped") throw conflict("중단된 할 일만 재개할 수 있습니다");
  const today = dateIn(task.timezone, now);
  const last = task.pauses.at(-1);
  if (!last || last.resumed_on !== null) throw new AppError("internal", "중단 이력이 상태와 맞지 않습니다");
  // 같은 날 중단·재개하면 빈 중단이므로 남기지 않는다.
  const pauses = last.stopped_on === today
    ? task.pauses.slice(0, -1)
    : [...task.pauses.slice(0, -1), { stopped_on: last.stopped_on, resumed_on: today }];
  return { status: "active", pauses };
}

/**
 * 회차 기록 가능 여부: 규칙상 회차이고 시작일 이후, 중단 기간 밖, 오늘(할 일의 시간대) 또는 그 이전.
 * 한 회차에 여러 번 기록할 수 있다.
 */
export function assertRecordableOccurrence(task: Task, date: string, now: Date): void {
  requireRecurring(task);
  const today = dateIn(task.timezone, now);
  const field = [{ path: "date", message: "" }];
  if (date > today) {
    field[0].message = "미래 날짜에는 기록할 수 없습니다";
  } else if (!isOccurrence(task.recurrence, task.pauses, date)) {
    field[0].message = "이 할 일의 회차가 아닙니다(규칙·시작일·중단 기간 확인)";
  } else {
    return;
  }
  throw invalidInput(field[0].message, field);
}

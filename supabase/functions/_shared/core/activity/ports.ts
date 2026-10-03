// 할 일·기록 유스케이스가 쓰는 저장 계약. SQL·SDK 타입을 노출하지 않는다.
import type { Actor } from "../shared/actor.ts";
import type { IndexJob } from "../shared/store.ts";
import type { NewTask, Task } from "./domain.ts";

export interface ActivityRecord {
  tag_ids: string[];
  id: string;
  title: string;
  summary: string;
  body: string;
  occurred_at: string;
  task_id: string | null;
  occurrence_on: string | null;
  applied_principle_ids: string[];
  applied_principles: {
    id: string;
    title: string;
    status: "active" | "inactive";
    updated_at: string;
    version: number;
  }[];
  version: number;
  created_at: string;
  updated_at: string;
}

export interface NewRecord {
  tag_ids?: string[];
  applied_principle_ids?: string[];
  title: string;
  summary: string;
  body: string;
  occurred_at: string | null;
  task_id: string | null;
  occurrence_on: string | null;
}

export type RecordChanges = Partial<
  Pick<ActivityRecord, "title" | "summary" | "body" | "occurred_at" | "applied_principle_ids" | "tag_ids">
>;

/** 목록의 다음 위치(정렬 키 + id). */
export interface Keyset {
  at: string;
  id: string;
}

export interface TaskFilter {
  tag_id?: string;
  kind?: "once" | "recurring";
  status?: Task["status"];
  due_from?: string;
  due_to?: string;
  after?: Keyset;
  limit: number;
}

export interface RecordFilter {
  tag_id?: string;
  occurred_from?: string;
  occurred_to?: string;
  task_id?: string;
  after?: Keyset;
  limit: number;
}

export type { IndexJob } from "../shared/store.ts";

export interface StoredRequest {
  request_hash: string;
  response: unknown;
}

/** 한 트랜잭션 안의 저장소. 모든 조회·쓰기·큐 등록이 같은 연결을 쓴다. */
export interface ActivityStore {
  /** 같은 요청 키의 동시 처리를 직렬화한다(트랜잭션 끝까지). */
  lockRequest(operation: string, requestId: string): Promise<void>;
  findRequest(operation: string, requestId: string): Promise<StoredRequest | null>;
  saveRequest(operation: string, requestId: string, requestHash: string, response: unknown): Promise<void>;

  getTask(id: string, opts?: { forUpdate?: boolean }): Promise<Task | null>;
  listTasks(filter: TaskFilter): Promise<Task[]>;
  insertTask(task: NewTask): Promise<Task>;
  /** 버전을 1 올리고 updated_at을 갱신한다. */
  updateTask(id: string, changes: Partial<Task>): Promise<Task>;
  deleteTask(id: string): Promise<void>;

  getRecord(id: string, opts?: { forUpdate?: boolean }): Promise<ActivityRecord | null>;
  getRecordSummaries(ids: string[]): Promise<Pick<ActivityRecord, "id" | "title" | "summary">[]>;
  listRecords(filter: RecordFilter): Promise<ActivityRecord[]>;
  occurrenceRecords(taskId: string, from: string, to: string): Promise<{ id: string; occurrence_on: string }[]>;
  insertRecord(record: NewRecord): Promise<ActivityRecord>;
  updateRecord(id: string, changes: RecordChanges): Promise<ActivityRecord>;
  deleteRecord(id: string): Promise<void>;
  /** 할 일 삭제 전 연결된 기록의 task_id·occurrence_on을 비운다. */
  detachRecords(taskId: string): Promise<void>;
  /** 이 기록을 결과로 가진 일회성 할 일. */
  taskWithResult(recordId: string): Promise<Task | null>;

  enqueueIndex(job: IndexJob): Promise<void>;
}

export interface UnitOfWork {
  /** Actor 문맥으로 트랜잭션을 연다. fn이 실패하면 모두 롤백한다. */
  run<T>(actor: Actor, fn: (store: ActivityStore) => Promise<T>): Promise<T>;
}

export interface Clock {
  now(): Date;
}

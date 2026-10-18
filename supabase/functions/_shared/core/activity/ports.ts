// 할 일·기록 유스케이스가 쓰는 저장 계약. SQL·SDK 타입을 노출하지 않는다.
import type { RequestStore } from "../shared/request.ts";
import type { Actor } from "../shared/actor.ts";
import type { ChangeStore } from "../shared/changes.ts";
import type { ChangeMetadata } from "../../contracts/change.ts";
import type { IndexJob } from "../shared/store.ts";
import type { NewTask, Task } from "./domain.ts";

export interface ActivityRecord {
  entity_id: string | null;
  record_kind: "result" | "change";
  change?: ChangeMetadata | null;
  tag_ids: string[];
  id: string;
  body: string;
  occurred_at: string;
  task_id: string | null;
  occurrence_on: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface NewRecord {
  body: string;
  occurred_at: string | null;
  task_id: string;
  occurrence_on: string | null;
}

export type RecordChanges = Partial<
  Pick<
    ActivityRecord,
    "body" | "occurred_at"
  >
>;

/** 목록의 다음 위치(정렬 키 + id). */
export interface Keyset {
  at: string;
  id: string;
}

export interface TaskFilter {
  deleted?: "include" | "only";
  keyword?: string;
  tag_ids?: string[];
  entity_id?: string;
  tag_id?: string;
  kind?: "once" | "recurring";
  status?: Task["status"];
  due_from?: string;
  due_to?: string;
  after?: Keyset;
  limit: number;
}

export interface RecordFilter {
  tag_ids?: string[];
  record_kind?: "result" | "change";
  entity_id?: string;
  tag_id?: string;
  occurred_from?: string;
  occurred_to?: string;
  task_id?: string;
  after?: Keyset;
  limit: number;
}

export type { IndexJob } from "../shared/store.ts";

/** 한 트랜잭션 안의 저장소. 모든 조회·쓰기·큐 등록이 같은 연결을 쓴다. */
export interface ActivityStore extends ChangeStore, RequestStore {
  /** Current read projection only; the original task remains available for mutation decisions. */
  visibleTask?(task: Task): Promise<Task>;
  getTask(
    id: string,
    opts?: { forUpdate?: boolean; entityIds?: string[]; selectionWrite?: boolean },
  ): Promise<Task | null>;
  listTasks(filter: TaskFilter): Promise<Task[]>;
  insertTask(task: NewTask): Promise<Task>;
  /** 버전을 1 올리고 updated_at을 갱신한다. */
  updateTask(id: string, changes: Partial<Task>): Promise<Task>;

  getRecord(
    id: string,
    opts?: { forUpdate?: boolean },
  ): Promise<ActivityRecord | null>;
  getRecordBodies(ids: string[]): Promise<Pick<ActivityRecord, "id" | "body">[]>;
  listRecords(filter: RecordFilter): Promise<ActivityRecord[]>;
  /** Batch facts in task/date/occurred-at/id order, inside this transaction. Empty ids read nothing. */
  occurrenceRecords(
    taskIds: string[],
    from: string,
    to: string,
  ): Promise<{ task_id: string; id: string; occurrence_on: string }[]>;
  insertRecord(record: NewRecord): Promise<ActivityRecord>;
  updateRecord(id: string, changes: RecordChanges): Promise<ActivityRecord>;
  deleteRecord(id: string): Promise<void>;
  /** 이 기록을 결과로 가진 일회성 할 일. */
  taskWithResult(recordId: string): Promise<Task | null>;

  enqueueIndex(job: IndexJob): Promise<void>;
}

export interface UnitOfWork {
  /** Actor 문맥으로 트랜잭션을 연다. fn이 실패하면 모두 롤백한다. */
  run<T>(actor: Actor, fn: (store: ActivityStore) => Promise<T>, entry?: ActivityEntry): Promise<T>;
}

export interface ActivityEntry {
  access: "read" | "write";
  recordId?: string;
}

export interface Clock {
  now(): Date;
}

import type { PrincipleCreate, PrincipleResult, PrincipleUpdate } from "../../contracts/principle.ts";
import type { Actor } from "../shared/actor.ts";
import type { IndexJob, RequestStore } from "../shared/store.ts";
import type { ChangeStore } from "../shared/changes.ts";
export interface PrincipleStore extends RequestStore, ChangeStore {
  /** Mutation reads serialize the owner even when current is absent, until the transaction ends.
   * Acquire any request lock first; insert/update/delete follow this locked read in the same transaction.
   * Writes allocate revisions, including deletion; reads and core no-ops allocate none.
   */
  current(options?: { forUpdate?: boolean }): Promise<PrincipleResult | null>;
  insert(input: Omit<PrincipleCreate, "request_id">): Promise<PrincipleResult>;
  get(id: string): Promise<PrincipleResult | null>;
  update(
    id: string,
    changes: Pick<PrincipleUpdate, "change_note"> & Partial<Pick<PrincipleResult, "title" | "summary" | "body">>,
  ): Promise<PrincipleResult>;
  delete(id: string): Promise<void>;
  enqueueIndex(job: IndexJob): Promise<void>;
}
export interface PrincipleUnitOfWork {
  run<T>(actor: Actor, fn: (store: PrincipleStore) => Promise<T>): Promise<T>;
}

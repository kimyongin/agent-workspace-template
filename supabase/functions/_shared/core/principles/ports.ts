import type { PrincipleCreate, PrincipleResult, PrincipleUpdate } from "../../contracts/principle.ts";
import type { Actor } from "../shared/actor.ts";
import type { IndexJob, Keyset, RequestStore } from "../shared/store.ts";
import type { ChangeStore } from "../shared/changes.ts";
export interface PrincipleStore extends RequestStore, ChangeStore {
  lockCurrent(): Promise<void>;
  nextVersion(): Promise<number>;
  current(): Promise<PrincipleResult | null>;
  insert(input: Omit<PrincipleCreate, "request_id">, version?: number): Promise<PrincipleResult>;
  get(id: string, forUpdate?: boolean): Promise<PrincipleResult | null>;
  update(
    id: string,
    changes: Pick<PrincipleUpdate, "change_note"> & Partial<Pick<PrincipleResult, "title" | "summary" | "body">>,
    version?: number,
  ): Promise<PrincipleResult>;
  retire(id: string): Promise<void>;
  delete(id: string): Promise<void>;
  promoteLatest(version: number): Promise<void>;
  list(filter: { view: "current" | "history" | "all"; limit: number; after?: Keyset }): Promise<PrincipleResult[]>;
  enqueueIndex(job: IndexJob): Promise<void>;
}
export interface PrincipleUnitOfWork {
  run<T>(actor: Actor, fn: (store: PrincipleStore) => Promise<T>): Promise<T>;
}

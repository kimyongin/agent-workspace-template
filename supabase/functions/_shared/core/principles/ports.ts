import type { PrincipleCreate, PrincipleResult } from "../../contracts/principle.ts";
import type { Actor } from "../shared/actor.ts";
import type { IndexJob, Keyset, RequestStore } from "../shared/store.ts";

export interface PrincipleStore extends RequestStore {
  insert(input: Omit<PrincipleCreate, "request_id">): Promise<PrincipleResult>;
  get(id: string): Promise<PrincipleResult | null>;
  list(filter: { status: "active" | "inactive"; limit: number; after?: Keyset }): Promise<PrincipleResult[]>;
  enqueueIndex(job: IndexJob): Promise<void>;
}
export interface PrincipleUnitOfWork {
  run<T>(actor: Actor, fn: (store: PrincipleStore) => Promise<T>): Promise<T>;
}

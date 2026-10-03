import type { PrincipleCreate, PrincipleResult } from "../../contracts/principle.ts";
import type { Actor } from "../shared/actor.ts";
import type { IndexJob, Keyset, RequestStore } from "../shared/store.ts";

export interface PrincipleStore extends RequestStore {
  insert(input: Omit<PrincipleCreate, "request_id">): Promise<PrincipleResult>;
  get(id: string, forUpdate?: boolean): Promise<PrincipleResult | null>;
  update(
    id: string,
    changes: Partial<
      Pick<
        PrincipleResult,
        "title" | "summary" | "body" | "applies_when" | "status" | "replaced_by_id" | "tag_ids" | "entity_id"
      >
    >,
  ): Promise<PrincipleResult>;
  delete(id: string): Promise<void>;
  list(
    filter: { status: "active" | "inactive"; tag_id?: string; entity_id?: string; limit: number; after?: Keyset },
  ): Promise<PrincipleResult[]>;
  enqueueIndex(job: IndexJob): Promise<void>;
}
export interface PrincipleUnitOfWork {
  run<T>(actor: Actor, fn: (store: PrincipleStore) => Promise<T>): Promise<T>;
}

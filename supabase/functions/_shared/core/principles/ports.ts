import type { PrincipleCreate, PrincipleResult } from "../../contracts/principle.ts";
import type { Actor } from "../shared/actor.ts";
import type { ChangeStore } from "../shared/changes.ts";
export interface PrincipleStore extends ChangeStore {
  /** Mutation reads serialize the owner even when current is absent, until the transaction ends.
   * Insert/update/delete follow this locked read in the same transaction.
   * Each document starts at version 1; actual updates increment only that document.
   */
  current(options?: { forUpdate?: boolean }): Promise<PrincipleResult | null>;
  insert(input: PrincipleCreate): Promise<PrincipleResult>;
  get(id: string): Promise<PrincipleResult | null>;
  update(
    id: string,
    changes: Partial<Pick<PrincipleResult, "title" | "body">>,
  ): Promise<PrincipleResult>;
  delete(id: string): Promise<void>;
}
export interface PrincipleUnitOfWork {
  run<T>(actor: Actor, fn: (store: PrincipleStore) => Promise<T>): Promise<T>;
}

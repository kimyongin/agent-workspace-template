import type { EntityTypeDeps } from "./application.ts";
import type { Actor } from "../shared/actor.ts";
import { requestIdentity } from "../shared/request.ts";
import { AppError, invalidInput } from "../shared/errors.ts";
import { retainedSchemaRequestInputs } from "./retained-request-input.ts";

/** A read-only candidate lookup cannot authorize an old input to execute a new write. */
export async function findRetainedSchemaRequest<T>(
  d: EntityTypeDeps, actor: Actor, operation: string, target: unknown, raw: unknown,
): Promise<{ found: boolean; result?: T; mismatch?: AppError }> {
  const inputs = retainedSchemaRequestInputs(operation, raw);
  if (!inputs.length) return { found: false };
  return d.uow.run(actor, async (store) => {
    let mismatch: AppError | undefined;
    for (const input of inputs) {
      const identity = await requestIdentity(actor, operation, target, input);
      try {
        const receipt = await store.replayRetainedRequest<T>?.(identity);
        if (receipt?.found) return receipt;
      } catch (error) {
        // A different generation can share this key. Current execution still enforces
        // key reuse when none of the exact retained normalized inputs matches.
        if (!(error instanceof AppError) || error.code !== "idempotency_key_reused") throw error;
        mismatch = error;
      }
    }
    return { found: false, mismatch };
  });
}
/** Retired inputs can reproduce only an exact already successful receipt. */
export async function replayRetainedSchemaRequest<T>(
  d: EntityTypeDeps, actor: Actor, operation: string, target: unknown, raw: unknown,
): Promise<T> {
  const receipt = await findRetainedSchemaRequest<T>(d, actor, operation, target, raw);
  if (receipt.mismatch && !receipt.found) throw receipt.mismatch;
  if (!receipt.found) throw invalidInput("전환 전 입력은 보관된 성공 요청의 정확한 재확인에만 사용할 수 있습니다");
  return receipt.result as T;
}

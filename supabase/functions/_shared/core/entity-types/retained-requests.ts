import type { EntityTypeDeps } from "./application.ts";
import type { Actor } from "../shared/actor.ts";
import { requestIdentity } from "../shared/request.ts";
import { invalidInput } from "../shared/errors.ts";
import { retainedSchemaRequestInput } from "./retained-request-input.ts";
/** Transition-only read of an existing retained receipt. No old input can execute a write. */
export async function replayRetainedSchemaRequest<T>(
  d: EntityTypeDeps,
  actor: Actor,
  operation: string,
  target: unknown,
  raw: unknown,
): Promise<T> {
  const decoded = retainedSchemaRequestInput(operation, raw);
  if (!decoded?.success) throw invalidInput("현재 단일 문서 계약의 입력을 사용하세요");
  const identity = await requestIdentity(actor, operation, target, decoded.data);
  return d.uow.run(actor, async (store) => {
    const receipt = await store.replayRetainedRequest<T>?.(identity);
    if (!receipt?.found) throw invalidInput("전환 전 입력은 보관된 성공 요청의 정확한 재확인에만 사용할 수 있습니다");
    return receipt.result as T;
  });
}

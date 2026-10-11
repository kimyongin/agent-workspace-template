import type postgres from "postgres";
import { REQUEST_RESULT_MAX_BYTES } from "../../contracts/request.ts";
import type { Actor } from "../../core/shared/actor.ts";
import type { RequestIdentity } from "../../core/shared/request.ts";
import { AppError } from "../../core/shared/errors.ts";
export async function executeSqlRequest<T>(
  tx: postgres.TransactionSql,
  actor: Actor,
  request: RequestIdentity,
  execute: () => Promise<T>,
): Promise<T> {
  const [row] =
    await tx`select app.begin_request(${request.key}::uuid, ${request.operation}, ${request.fingerprint}) as receipt`;
  const receipt = row.receipt as { state: string; result?: T; completed_at?: string };
  if (receipt.state === "replay") {
    if (actor.request) {
      actor.request.replayed = true;
      actor.request.completed_at = receipt.completed_at;
    }
    return receipt.result as T;
  }
  if (receipt.state !== "new") {
    const codes = [
      "idempotency_key_reused",
      "request_in_progress",
      "result_expired",
    ] as const;
    const code = codes.find((code) => code === receipt.state);
    if (!code) throw new AppError("internal", "요청 결과를 확인할 수 없습니다");
    throw new AppError(
      code,
      {
        idempotency_key_reused: "같은 요청 키에 다른 입력을 사용할 수 없습니다",
        request_in_progress: "동일 요청이 처리 중입니다. 같은 키와 입력으로 다시 시도하세요",
        result_expired: "요청 키와 결과의 30일 보관 기간이 지났습니다. 현재 상태를 확인하세요",
      }[code],
    );
  }
  // Subsequent domain locks retain their established limit; only request competition is 2s.
  await tx`select set_config('lock_timeout', '5s', true)`;
  const result = await execute();
  const json = JSON.stringify(result ?? null);
  if (new TextEncoder().encode(json).byteLength > REQUEST_RESULT_MAX_BYTES) {
    throw new AppError("invalid_input", "응답이 1 MiB 요청 보관 한도를 넘었습니다. 변경은 저장되지 않았습니다");
  }
  await tx`select app.finish_request(${request.key}::uuid, ${tx.json(JSON.parse(json))})`;
  return result;
}

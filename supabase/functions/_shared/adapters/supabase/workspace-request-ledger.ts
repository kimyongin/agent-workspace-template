import type postgres from "postgres";
import type { Actor } from "../../core/shared/actor.ts";
import type { RequestIdentity } from "../../core/shared/request.ts";
import type { WorkspaceRequirement } from "../../core/workspaces/application.ts";
import { AppError } from "../../core/shared/errors.ts";
import { lockWorkspace } from "./workspace-context.ts";
import { REQUEST_RESULT_MAX_BYTES } from "../../contracts/request.ts";

function receiptResult<T>(
  actor: Actor,
  receipt: { state: string; result?: T; completed_at?: string },
): { found: boolean; result?: T } {
  if (receipt.state === "missing") return { found: false };
  if (receipt.state === "replay") {
    if (actor.request) {
      actor.request.replayed = true;
      actor.request.completed_at = receipt.completed_at;
    }
    return { found: true, result: receipt.result };
  }
  if (receipt.state === "new") return { found: false };
  if (receipt.state === "idempotency_key_reused") {
    throw new AppError("idempotency_key_reused", "같은 요청 키에 다른 입력을 사용할 수 없습니다");
  }
  if (receipt.state === "request_in_progress") {
    throw new AppError("request_in_progress", "동일 요청이 처리 중입니다. 같은 키와 입력으로 다시 시도하세요");
  }
  if (receipt.state === "result_expired") {
    throw new AppError("result_expired", "요청 결과의 30일 보관 기간이 지났습니다");
  }
  throw new AppError("internal", "요청 결과를 확인할 수 없습니다");
}
export async function executeWorkspaceRequest<T>(
  tx: postgres.TransactionSql,
  actor: Actor,
  request: RequestIdentity,
  footprint: WorkspaceRequirement[],
  execute: () => Promise<T>,
  account = false,
): Promise<T> {
  if (account) {
    const [target] =
      await tx`select app.account_workspace_request_target(${request.key}::uuid,${request.operation},${request.fingerprint}) as workspace_id`;
    if (target.workspace_id) {
      await lockWorkspace(
        tx,
        target.workspace_id,
        request.operation === "workspace.invitation.accept" ? "control" : "business",
      );
    }
  }
  const [row] = account
    ? await tx`select app.begin_account_workspace_request(${request.key}::uuid,${request.operation},${request.fingerprint}) as receipt`
    : await tx`select app.begin_workspace_request(${request.key}::uuid,${request.operation},${request.fingerprint},${
      tx.json(footprint as never)
    }) as receipt`;
  const receipt = receiptResult<T>(actor, row.receipt);
  if (receipt.found) return receipt.result as T;
  await tx`select set_config('lock_timeout','5s',true)`;
  const result = await execute();
  const savedFootprint: WorkspaceRequirement[] = account && request.operation === "workspace.create"
    ? [{ target_kind: "settings", target_id: "*", access: "write" }]
    : footprint;
  const json = JSON.stringify(result ?? null);
  if (new TextEncoder().encode(json).byteLength > REQUEST_RESULT_MAX_BYTES) {
    throw new AppError("invalid_input", "응답이 1 MiB 요청 보관 한도를 넘었습니다. 변경은 저장되지 않았습니다");
  }
  await tx`select app.finish_workspace_request(${request.key}::uuid,${tx.json(JSON.parse(json))},${
    tx.json(savedFootprint as never)
  },${account})`;
  return result;
}
/** Retained replay deliberately shares the DB authorization-before-body implementation. */
export async function replayRetainedWorkspaceRequest<T>(
  tx: postgres.TransactionSql,
  actor: Actor,
  request: RequestIdentity,
  footprint: WorkspaceRequirement[],
): Promise<{ found: boolean; result?: T }> {
  const [row] =
    await tx`select app.replay_retained_workspace_request(${request.key}::uuid,${request.operation},${request.fingerprint},${
      tx.json(footprint as never)
    }) as receipt`;
  return receiptResult<T>(actor, row.receipt);
}

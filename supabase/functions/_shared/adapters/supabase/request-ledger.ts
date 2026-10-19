import { executeWorkspaceRequest, replayRetainedWorkspaceRequest } from "./workspace-request-ledger.ts";
import type { WorkspaceRequirement } from "../../core/workspaces/application.ts";
import type postgres from "postgres";
import type { Actor } from "../../core/shared/actor.ts";
import type { RequestIdentity } from "../../core/shared/request.ts";
import { AppError } from "../../core/shared/errors.ts";
import { requireWorkspaceActor } from "./workspace-context.ts";
export async function executeSqlRequest<T>(
  tx: postgres.TransactionSql,
  actor: Actor,
  request: RequestIdentity,
  execute: () => Promise<T>,
): Promise<T> {
  requireWorkspaceActor(actor);
  const footprint = await workspaceFootprint(tx);
  return executeWorkspaceRequest(tx, actor, request, footprint, async () => {
    const result = await execute();
    // Domain effects may resolve additional targets only after reading trusted
    // definitions. Preserve the same array consumed by common finish/replay.
    const resolved = new Map<string, WorkspaceRequirement>();
    for (const requirement of [...footprint, ...await workspaceFootprint(tx)]) {
      const key = `${requirement.target_kind}:${requirement.target_id}`;
      if (resolved.get(key)?.access !== "write") resolved.set(key, requirement);
    }
    footprint.splice(0, footprint.length, ...resolved.values());
    return result;
  });
}

/** Read-only retained lookup under the same current workspace authorization. */
export async function replayRetainedSqlRequest<T>(
  tx: postgres.TransactionSql,
  actor: Actor,
  request: RequestIdentity,
): Promise<{ found: boolean; result?: T }> {
  requireWorkspaceActor(actor);
  return replayRetainedWorkspaceRequest(tx, actor, request, await workspaceFootprint(tx));
}

/** Trusted common entry owns this transaction-local declaration; no transport permission arrays. */
async function workspaceFootprint(tx: postgres.TransactionSql): Promise<WorkspaceRequirement[]> {
  const [row] = await tx`select current_setting('request.workspace_requirements',true) as requirements`;
  if (!row.requirements) throw new AppError("internal", "워크스페이스 실행 문맥을 확인할 수 없습니다");
  return JSON.parse(row.requirements);
}

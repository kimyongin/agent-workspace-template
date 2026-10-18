import type postgres from "postgres";
import type { Actor } from "../../core/shared/actor.ts";
import type { WorkspaceActor, WorkspaceEntry, WorkspaceRequirement } from "../../core/workspaces/application.ts";
import { workspaceId } from "../../contracts/workspace.ts";
import { AppError, invalidInput } from "../../core/shared/errors.ts";
import { translate } from "./sql-context.ts";

export async function workspaceAccount<T>(
  sql: postgres.Sql,
  actor: Actor,
  fn: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  try {
    return await sql.begin("isolation level read committed", async (tx) => {
      await tx`select set_config('request.jwt.claims',${
        JSON.stringify({ sub: actor.userId, role: "authenticated" })
      },true),
        set_config('request.workspace_id','',true), set_config('request.workspace_lock_mode','',true),
        set_config('lock_timeout','5s',true),set_config('statement_timeout','15s',true)`;
      await tx`set local role app_user`;
      await tx`select app.lock_workspace_account()`;
      return await fn(tx);
    }) as T;
  } catch (e) {
    throw translate(e);
  }
}
/** Only this entry selects the lock mode. Never upgrade business to control or establish a stale repeatable-read snapshot. */
export function runInWorkspace<T>(
  sql: postgres.Sql,
  actor: WorkspaceActor,
  entry: WorkspaceEntry,
  fn: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  if (!workspaceId.safeParse(actor.workspaceId).success) throw invalidInput("워크스페이스가 필요합니다");
  return workspaceAccount(sql, actor, async (tx) => {
    await lockWorkspace(tx, actor.workspaceId, entry.mode);
    // Separate statement deliberately obtains the post-lock READ COMMITTED snapshot.
    await authorizeWorkspace(tx, entry.requirements);
    return await fn(tx);
  });
}
export async function lockWorkspace(tx: postgres.TransactionSql, id: string, mode: "business" | "control") {
  await tx`select app.lock_workspace(${id}::uuid,${mode === "control"})`;
  await tx`select set_config('request.workspace_id',${id},true),set_config('request.workspace_lock_mode',${mode},true)`;
}
export async function authorizeWorkspace(tx: postgres.TransactionSql, requirements: WorkspaceRequirement[]) {
  await tx`select app.authorize_workspace(${tx.json(requirements as never)})`;
}
export function requireWorkspaceActor(actor: Actor): WorkspaceActor {
  if (!workspaceId.safeParse(actor.workspaceId).success) {
    throw new AppError("invalid_input", "워크스페이스가 필요합니다");
  }
  return actor as WorkspaceActor;
}

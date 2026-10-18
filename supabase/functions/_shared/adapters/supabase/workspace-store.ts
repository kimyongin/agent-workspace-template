import type postgres from "postgres";
import type { Actor } from "../../core/shared/actor.ts";
import type { RequestIdentity } from "../../core/shared/request.ts";
import type {
  WorkspaceActor,
  WorkspaceEntry,
  WorkspaceRequirement,
  WorkspaceStore,
} from "../../core/workspaces/application.ts";
import type { Workspace, WorkspaceGrant } from "../../contracts/workspace.ts";
import { executeWorkspaceRequest } from "./workspace-request-ledger.ts";
import { lockWorkspace, runInWorkspace, workspaceAccount } from "./workspace-context.ts";

export class SqlWorkspaceStore implements WorkspaceStore {
  constructor(
    private tx: postgres.TransactionSql,
    private actor: Actor,
    private requirements: WorkspaceRequirement[],
    private account = false,
  ) {}
  executeRequest<T>(request: RequestIdentity, execute: () => Promise<T>): Promise<T> {
    return executeWorkspaceRequest(this.tx, this.actor, request, this.requirements, execute, this.account);
  }
  async create(name: string) {
    const [r] = await this.tx`select app.workspace_create(${name}) as result`;
    return r.result;
  }
  async list() {
    return {
      items: Array.from(
        await this.tx<Workspace[]>`select id,name,deleted_at from app.workspaces order by created_at,id`,
      ),
    };
  }
  async details() {
    const [r] = await this.tx`select app.workspace_details() as result`;
    return r.result;
  }
  async grantTargets() {
    const [r] = await this.tx`select app.workspace_grant_targets() as result`;
    return r.result;
  }
  async members() {
    const [r] = await this.tx`select app.workspace_members() as result`;
    return r.result;
  }
  async updateMember(userId: string, grants: WorkspaceGrant[], expectedVersion: number) {
    const [r] = await this.tx`select app.workspace_update_member(${userId}::uuid,${
      this.tx.json(grants as never)
    },${expectedVersion}) as result`;
    return r.result;
  }
  async removeMember(userId: string, expectedVersion: number) {
    const [r] = await this.tx`select app.workspace_remove_member(${userId}::uuid,${expectedVersion},false) as result`;
    return r.result;
  }
  async leave(expectedVersion: number) {
    const [r] = await this
      .tx`select app.workspace_remove_member(${this.actor.userId}::uuid,${expectedVersion},true) as result`;
    return r.result;
  }
  async invitations() {
    const [r] = await this.tx`select app.workspace_invitations() as result`;
    return r.result;
  }
  async invite(input: { email: string; grants: WorkspaceGrant[] }) {
    const [r] = await this.tx`select app.workspace_invite(${input.email},${
      this.tx.json(input.grants as never)
    }) as result`;
    return r.result;
  }
  async retryInvitationDelivery(id: string, expectedVersion: number) {
    const [r] = await this.tx`select app.workspace_retry_invitation_delivery(${id}::uuid,${expectedVersion}) as result`;
    return r.result;
  }
  async cancelInvitation(id: string, expectedVersion: number) {
    const [r] = await this.tx`select app.workspace_cancel_invitation(${id}::uuid,${expectedVersion}) as result`;
    return r.result;
  }
  async acceptInvitation(id: string) {
    const [r] = await this.tx`select app.workspace_accept_invitation(${id}::uuid) as result`;
    return r.result;
  }
}
export class SqlWorkspaceUnitOfWork {
  constructor(private sql: postgres.Sql) {}
  account<T>(actor: Actor, fn: (store: WorkspaceStore) => Promise<T>): Promise<T> {
    return workspaceAccount(this.sql, actor, (tx) => fn(new SqlWorkspaceStore(tx, actor, [], true)));
  }
  workspace<T>(actor: WorkspaceActor, entry: WorkspaceEntry, fn: (store: WorkspaceStore) => Promise<T>): Promise<T> {
    return runInWorkspace(this.sql, actor, entry, (tx) => fn(new SqlWorkspaceStore(tx, actor, entry.requirements)));
  }
  invitation<T>(actor: Actor, invitationId: string, fn: (store: WorkspaceStore) => Promise<T>): Promise<T> {
    return workspaceAccount(this.sql, actor, async (tx) => {
      const [r] = await tx`select app.workspace_invitation_target(${invitationId}::uuid) as workspace_id`;
      await lockWorkspace(tx, r.workspace_id, "control");
      return await fn(new SqlWorkspaceStore(tx, actor, [], true));
    });
  }
}

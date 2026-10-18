import type { Actor } from "../shared/actor.ts";
import { type RequestIdentity, requestIdentity, requireRequestKey } from "../shared/request.ts";
import { invalidInput } from "../shared/errors.ts";
import {
  type Workspace,
  type WorkspaceCapabilities,
  workspaceCreate,
  workspaceId,
  type WorkspaceInvitation,
  workspaceInvite,
  type WorkspaceMember,
  workspaceMemberUpdate,
  workspaceVersion,
} from "../../contracts/workspace.ts";

export interface WorkspaceActor extends Actor {
  workspaceId: string;
}
/** A use case declares only fixed permission targets. Existing object targets must be resolved from storage. */
export interface WorkspaceRequirement {
  target_kind: "entity_type" | "tasks" | "settings";
  target_id: string;
  access: "read" | "write";
}
export interface WorkspaceEntry {
  mode: "business" | "control";
  requirements: WorkspaceRequirement[];
}
export interface WorkspaceStore {
  executeRequest<T>(request: RequestIdentity, execute: () => Promise<T>): Promise<T>;
  create(name: string): Promise<{ workspace: Workspace }>;
  list(): Promise<{ items: Workspace[] }>;
  details(): Promise<WorkspaceCapabilities>;
  members(): Promise<{ items: WorkspaceMember[] }>;
  updateMember(
    userId: string,
    grants: WorkspaceMember["grants"],
    expectedVersion: number,
  ): Promise<{ member: WorkspaceMember }>;
  removeMember(userId: string, expectedVersion: number): Promise<{ removed: true }>;
  leave(expectedVersion: number): Promise<{ left: true }>;
  invitations(): Promise<{ items: WorkspaceInvitation[] }>;
  invite(
    input: { email: string; grants: WorkspaceMember["grants"] },
  ): Promise<{ invitation: WorkspaceInvitation; acceptance_path: string }>;
  cancelInvitation(id: string, expectedVersion: number): Promise<{ revoked: true }>;
  acceptInvitation(id: string): Promise<{ workspace: Workspace }>;
}
export interface WorkspaceDeps {
  uow: {
    account<T>(actor: Actor, fn: (store: WorkspaceStore) => Promise<T>): Promise<T>;
    workspace<T>(actor: WorkspaceActor, entry: WorkspaceEntry, fn: (store: WorkspaceStore) => Promise<T>): Promise<T>;
    invitation<T>(actor: Actor, invitationId: string, fn: (store: WorkspaceStore) => Promise<T>): Promise<T>;
  };
}
function parsed<T>(schema: { safeParse(v: unknown): { success: boolean; data?: T } }, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw invalidInput("입력 형식이 맞지 않습니다");
  return result.data as T;
}
export function workspaceActor(actor: Actor, id: unknown): WorkspaceActor {
  return { ...actor, workspaceId: parsed(workspaceId, id) };
}
const management: WorkspaceEntry = {
  mode: "control",
  requirements: [{ target_kind: "settings", target_id: "*", access: "write" }],
};
async function write<T>(
  store: WorkspaceStore,
  actor: Actor,
  operation: string,
  target: unknown,
  input: unknown,
  fn: () => Promise<T>,
) {
  return store.executeRequest(await requestIdentity(actor, operation, target, input), fn);
}
export function listWorkspaces(deps: WorkspaceDeps, actor: Actor) {
  return deps.uow.account(actor, (s) => s.list());
}
export async function createWorkspace(deps: WorkspaceDeps, actor: Actor, input: unknown) {
  requireRequestKey(actor);
  const value = parsed(workspaceCreate, input);
  return deps.uow.account(actor, (s) => write(s, actor, "workspace.create", null, value, () => s.create(value.name)));
}
export async function workspaceDetails(deps: WorkspaceDeps, actor: Actor, id: unknown) {
  return deps.uow.workspace(workspaceActor(actor, id), { mode: "business", requirements: [] }, (s) => s.details());
}
export function listWorkspaceMembers(deps: WorkspaceDeps, actor: Actor, id: unknown) {
  return deps.uow.workspace(workspaceActor(actor, id), management, (s) => s.members());
}
export function updateWorkspaceMember(deps: WorkspaceDeps, actor: Actor, id: unknown, userId: unknown, input: unknown) {
  requireRequestKey(actor);
  const scoped = workspaceActor(actor, id),
    user = parsed(workspaceId, userId),
    value = parsed(workspaceMemberUpdate, input);
  return deps.uow.workspace(
    scoped,
    management,
    (s) =>
      write(
        s,
        scoped,
        "workspace.member.update",
        user,
        value,
        () => s.updateMember(user, value.grants, value.expected_version),
      ),
  );
}
export function removeWorkspaceMember(deps: WorkspaceDeps, actor: Actor, id: unknown, userId: unknown, input: unknown) {
  requireRequestKey(actor);
  const scoped = workspaceActor(actor, id), user = parsed(workspaceId, userId), value = parsed(workspaceVersion, input);
  return deps.uow.workspace(
    scoped,
    management,
    (s) => write(s, scoped, "workspace.member.remove", user, value, () => s.removeMember(user, value.expected_version)),
  );
}
export function leaveWorkspace(deps: WorkspaceDeps, actor: Actor, id: unknown, input: unknown) {
  requireRequestKey(actor);
  const scoped = workspaceActor(actor, id), value = parsed(workspaceVersion, input);
  return deps.uow.workspace(
    scoped,
    { mode: "control", requirements: [] },
    (s) => write(s, scoped, "workspace.leave", scoped.userId, value, () => s.leave(value.expected_version)),
  );
}
export function listWorkspaceInvitations(deps: WorkspaceDeps, actor: Actor, id: unknown) {
  return deps.uow.workspace(workspaceActor(actor, id), management, (s) => s.invitations());
}
export function inviteWorkspaceMember(deps: WorkspaceDeps, actor: Actor, id: unknown, input: unknown) {
  requireRequestKey(actor);
  const scoped = workspaceActor(actor, id), value = parsed(workspaceInvite, input);
  return deps.uow.workspace(
    scoped,
    management,
    (s) => write(s, scoped, "workspace.invite", null, value, () => s.invite(value)),
  );
}
export function cancelWorkspaceInvitation(
  deps: WorkspaceDeps,
  actor: Actor,
  id: unknown,
  invitationId: unknown,
  input: unknown,
) {
  requireRequestKey(actor);
  const scoped = workspaceActor(actor, id),
    invitation = parsed(workspaceId, invitationId),
    value = parsed(workspaceVersion, input);
  return deps.uow.workspace(
    scoped,
    management,
    (s) =>
      write(
        s,
        scoped,
        "workspace.invitation.cancel",
        invitation,
        value,
        () => s.cancelInvitation(invitation, value.expected_version),
      ),
  );
}
export function acceptWorkspaceInvitation(deps: WorkspaceDeps, actor: Actor, invitationId: unknown) {
  requireRequestKey(actor);
  const invitation = parsed(workspaceId, invitationId);
  return deps.uow.invitation(
    actor,
    invitation,
    (s) => write(s, actor, "workspace.invitation.accept", invitation, {}, () => s.acceptInvitation(invitation)),
  );
}

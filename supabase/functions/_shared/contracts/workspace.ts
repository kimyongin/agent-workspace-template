import { z } from "zod";
import { text } from "./common.ts";

export const workspaceId = z.uuid();
export const accessLevel = z.enum(["none", "read", "write"]);
export const workspaceGrant = z.strictObject({
  target_kind: z.enum(["entity_type", "tasks", "settings"]),
  target_id: z.string().min(1).max(100),
  access: accessLevel,
}).refine((v) => v.target_kind === "entity_type" ? z.uuid().safeParse(v.target_id).success : v.target_id === "*", {
  message: "권한 대상이 올바르지 않습니다",
});
export const workspaceGrants = z.array(workspaceGrant).refine(
  (v) => new Set(v.map((g) => `${g.target_kind}:${g.target_id}`)).size === v.length,
  { message: "권한 대상이 중복되었습니다" },
);
export const workspaceCreate = z.strictObject({ name: text(1, 100) });
export const workspaceMemberUpdate = z.strictObject({
  expected_version: z.number().int().positive(),
  grants: workspaceGrants,
});
export const workspaceInvite = z.strictObject({
  email: z.string().trim().toLowerCase().pipe(z.email().max(320)),
  grants: workspaceGrants,
});
export type WorkspaceGrant = z.infer<typeof workspaceGrant>;
export interface Workspace {
  id: string;
  name: string;
  deleted_at: string | null;
}
export interface WorkspaceCapabilities {
  workspace: Workspace;
  grants: WorkspaceGrant[];
  can_manage: boolean;
  membership_version: number;
}
export const workspaceVersion = z.strictObject({ expected_version: z.number().int().positive() });
export interface WorkspaceMember {
  user_id: string;
  version: number;
  grants: WorkspaceGrant[];
}
export interface WorkspaceInvitation {
  id: string;
  workspace_id: string;
  version: number;
  email: string;
  grants: WorkspaceGrant[];
  expires_at: string;
  revoked_at: string | null;
  accepted_by: string | null;
  accepted_at: string | null;
}

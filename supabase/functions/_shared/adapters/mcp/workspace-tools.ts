import { z } from "zod";
import {
  workspaceCreate,
  workspaceId,
  workspaceInvite,
  workspaceLifecycleChange,
  workspaceMemberUpdate,
  workspaceVersion,
} from "../../contracts/workspace.ts";
import {
  acceptWorkspaceInvitation,
  cancelWorkspaceInvitation,
  createWorkspace,
  deleteWorkspace,
  inviteWorkspaceMember,
  leaveWorkspace,
  listDeletedWorkspaces,
  listWorkspaceInvitations,
  listWorkspaceMembers,
  listWorkspaces,
  removeWorkspaceMember,
  restoreWorkspace,
  retryWorkspaceInvitationDelivery,
  updateWorkspaceMember,
  type WorkspaceDeps,
  workspaceDetails,
  workspaceGrantTargets,
  workspaceLifecycleDetails,
  workspaceMembershipDetails,
} from "../../core/workspaces/application.ts";
import { keyedTool, type ToolDef } from "./tools.ts";
export function workspaceTools(deps: WorkspaceDeps): ToolDef[] {
  const scope = { workspace_id: workspaceId };
  const tools: ToolDef[] = [
    {
      name: "get_workspace_membership",
      description:
        "참여자가 현재 자신의 참여 버전과 공간의 최소 식별 정보를 확인합니다. 삭제 공간의 탈퇴를 지원하며 업무 데이터나 다른 참여자 권한을 공개하지 않습니다.",
      input: z.strictObject(scope),
      readOnly: true,
      handler: (i, a) => workspaceMembershipDetails(deps, a, i.workspace_id),
    },
    {
      name: "list_deleted_workspaces",
      description: "현재 유효한 관리자만 자신이 복원할 수 있는 삭제 공간의 최소 목록을 조회합니다.",
      input: z.strictObject({}),
      readOnly: true,
      handler: (_, a) => listDeletedWorkspaces(deps, a),
    },
    {
      name: "get_workspace_lifecycle",
      description: "관리자용 현재 공간 삭제 상태와 수명 세대 조회. 일반 업무 접근을 허용하지 않습니다.",
      input: z.strictObject(scope),
      readOnly: true,
      handler: (i, a) => workspaceLifecycleDetails(deps, a, i.workspace_id),
    },
    {
      name: "delete_workspace",
      description:
        "관리자가 현재 세대의 공간을 소프트 삭제합니다. 공동 데이터는 보존하며 업무 접근과 이전 비동기 실행을 중단합니다.",
      input: z.strictObject({ ...scope, ...workspaceLifecycleChange.shape }),
      readOnly: false,
      destructive: true,
      handler: ({ workspace_id, ...i }, a) => deleteWorkspace(deps, a, workspace_id, i),
    },
    {
      name: "restore_workspace",
      description: "현재 유효한 관리자가 삭제 공간을 새 수명 세대로 복원합니다. 오래된 작업을 재시작하지 않습니다.",
      input: z.strictObject({ ...scope, ...workspaceLifecycleChange.shape }),
      readOnly: false,
      handler: ({ workspace_id, ...i }, a) => restoreWorkspace(deps, a, workspace_id, i),
    },
    {
      name: "list_workspaces",
      description: "현재 참여 중인 활성 공간 목록. 공간 선택은 각 후속 도구의 workspace_id로 명시합니다.",
      input: z.strictObject({}),
      readOnly: true,
      handler: (_, a) => listWorkspaces(deps, a),
    },
    {
      name: "create_workspace",
      description: "공간과 첫 설정 쓰기 참여를 원자적으로 생성합니다. 자료 권한을 자동 부여하지 않습니다.",
      input: workspaceCreate,
      readOnly: false,
      handler: (i, a) => createWorkspace(deps, a, i),
    },
    {
      name: "get_workspace",
      description: "선택 공간과 현재 권한 조회.",
      input: z.strictObject(scope),
      readOnly: true,
      handler: (i, a) => workspaceDetails(deps, a, i.workspace_id),
    },
    {
      name: "list_workspace_grant_targets",
      description: "관리자가 권한을 지정할 자료 종류의 최소 식별 목록.",
      input: z.strictObject(scope),
      readOnly: true,
      handler: (i, a) => workspaceGrantTargets(deps, a, i.workspace_id),
    },
    {
      name: "list_workspace_members",
      description: "관리자용 현재 참여자와 권한 조회.",
      input: z.strictObject(scope),
      readOnly: true,
      handler: (i, a) => listWorkspaceMembers(deps, a, i.workspace_id),
    },
    {
      name: "update_workspace_member",
      description: "관리자가 현재 버전의 참여 권한 전체를 명시 교체합니다. 마지막 관리자 보호.",
      input: z.strictObject({ ...scope, user_id: workspaceId, ...workspaceMemberUpdate.shape }),
      readOnly: false,
      handler: ({ workspace_id, user_id, ...i }, a) => updateWorkspaceMember(deps, a, workspace_id, user_id, i),
    },
    {
      name: "remove_workspace_member",
      description: "관리자가 현재 버전의 참여자를 제외합니다. 마지막 관리자 보호.",
      input: z.strictObject({ ...scope, user_id: workspaceId, ...workspaceVersion.shape }),
      readOnly: false,
      destructive: true,
      handler: ({ workspace_id, user_id, ...i }, a) => removeWorkspaceMember(deps, a, workspace_id, user_id, i),
    },
    {
      name: "leave_workspace",
      description: "현재 버전으로 참여를 종료합니다. 활성 공간의 마지막 관리자는 권한을 넘기거나 공간을 삭제한 뒤 탈퇴합니다. 공동 데이터는 보존합니다.",
      input: z.strictObject({ ...scope, ...workspaceVersion.shape }),
      readOnly: false,
      destructive: true,
      handler: ({ workspace_id, ...i }, a) => leaveWorkspace(deps, a, workspace_id, i),
    },
    {
      name: "list_workspace_invitations",
      description: "관리자용 이메일 초대와 전달 상태 조회.",
      input: z.strictObject(scope),
      readOnly: true,
      handler: (i, a) => listWorkspaceInvitations(deps, a, i.workspace_id),
    },
    {
      name: "invite_workspace_member",
      description: "관리자가 이메일과 명시 권한으로 초대합니다. 전달 상태와 수락 경로를 확인하세요.",
      input: z.strictObject({ ...scope, ...workspaceInvite.shape }),
      readOnly: false,
      handler: ({ workspace_id, ...i }, a) => inviteWorkspaceMember(deps, a, workspace_id, i),
    },
    {
      name: "cancel_workspace_invitation",
      description: "관리자가 수락 전 현재 버전의 초대를 취소합니다.",
      input: z.strictObject({ ...scope, invitation_id: workspaceId, ...workspaceVersion.shape }),
      readOnly: false,
      destructive: true,
      handler: ({ workspace_id, invitation_id, ...i }, a) =>
        cancelWorkspaceInvitation(deps, a, workspace_id, invitation_id, i),
    },
    {
      name: "accept_workspace_invitation",
      description:
        "서버가 확인한 현재 Google identity의 검증된 이메일과 일치하는 초대를 명시 수락합니다. 요청 이메일/프로필 메타데이터는 사용하지 않습니다.",
      input: z.strictObject({ invitation_id: workspaceId }),
      readOnly: false,
      handler: (i, a) => acceptWorkspaceInvitation(deps, a, i.invitation_id),
    },
    {
      name: "retry_workspace_invitation_delivery",
      description:
        "관리자가 현재 버전의 초대 이메일 전달을 명시 재시도합니다. 결과 불명은 공급자 중복 방지 기간에만 재시도하며 발송 접수와 수신 확인을 구분합니다.",
      input: z.strictObject({ ...scope, invitation_id: workspaceId, ...workspaceVersion.shape }),
      readOnly: false,
      handler: ({ workspace_id, invitation_id, ...i }, a) =>
        retryWorkspaceInvitationDelivery(deps, a, workspace_id, invitation_id, i),
    },
  ];
  return tools.map((t) => t.readOnly ? t : keyedTool(t));
}

import type { ReactNode } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useWorkspaceCapabilities } from "../workspaces/workspace-context.tsx";

/** Presentation of the server's fixed settings target; API authorization remains authoritative. */
export function useSettingsAccess() {
  const capability = useWorkspaceCapabilities();
  const access = capability?.grants.find(grant => grant.target_kind === "settings" && grant.target_id === "*")?.access;
  return { canRead: access === "read" || access === "write", canWrite: access === "write" };
}

/** Never mount a settings reader before the server has granted settings access. */
export function WorkspaceSettingsBoundary({ children }: { children: ReactNode }) {
  const { canRead, canWrite } = useSettingsAccess();
  if (!canRead) return <Alert><AlertTitle>설정 조회 권한이 필요합니다</AlertTitle><AlertDescription>공간 관리자에게 설정 조회 권한을 요청하세요. 개인 기본 설정은 계속 사용할 수 있습니다.</AlertDescription></Alert>;
  return <div className="flex min-w-0 flex-col gap-6">
    {!canWrite && <Alert><AlertTitle>읽기 전용 설정</AlertTitle><AlertDescription>현재 설정과 변경 이력을 확인할 수 있습니다. 설정을 변경하려면 편집 권한이 필요합니다.</AlertDescription></Alert>}
    {children}
  </div>;
}

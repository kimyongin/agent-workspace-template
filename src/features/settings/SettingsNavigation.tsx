import { workspacePath } from "../../lib/workspace-route.tsx";

export const settingsCategories = [
  { to: "/settings", label: "기본" },
  { to: "/settings/materials", label: "자료" },
  { to: "/settings/tags", label: "태그" },
  { to: "/settings/records", label: "기록" },
] as const;

/** Account destinations remain available independently of the current space's settings grant. */
export function workspaceSettingsDestinations(workspaceId: string | null, canManage: boolean) {
  return [
    ...(workspaceId && canManage ? [{ to: workspacePath(workspaceId, "/manage"), label: "이 공간 관리" }] : []),
    { to: "/workspaces", label: "공간 목록 · 새 공간" },
  ];
}

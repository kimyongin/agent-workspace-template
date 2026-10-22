import { BookOpenIcon, DatabaseIcon, SettingsIcon, TagsIcon } from "lucide-react";
import { workspacePath } from "../../lib/workspace-route.tsx";

export const settingsCategories = [
  { to: "/settings", label: "기본 설정", icon: SettingsIcon },
  { to: "/settings/materials", label: "자료 설정", icon: DatabaseIcon },
  { to: "/settings/tags", label: "태그 설정", icon: TagsIcon },
  { to: "/settings/records", label: "기록 설정", icon: BookOpenIcon },
] as const;

/** Account destinations remain available independently of the current space's settings grant. */
export function workspaceSettingsDestinations(workspaceId: string | null, canManage: boolean) {
  return [
    ...(workspaceId && canManage ? [{ to: workspacePath(workspaceId, "/manage"), label: "이 공간 관리" }] : []),
    { to: "/workspaces", label: "공간 목록 · 새 공간" },
  ];
}

/** All material subpages belong to one drawer destination, including direct and legacy routes. */
export function settingsCategoryCurrent(pathname: string, target: string) {
  if (target === "/settings") return pathname === target || pathname === "/settings/navigation";
  return pathname === target || pathname.startsWith(`${target}/`) ||
    target === "/settings/materials" &&
      ["/settings/entity-types", "/settings/relations", "/settings/issuers", "/settings/data-model"]
        .some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

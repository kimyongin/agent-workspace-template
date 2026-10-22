import { WorkspaceSwitcher } from "../features/workspaces/WorkspaceSwitcher.tsx";
import { useRequestScope } from "../lib/api-context.tsx";
import { useApi } from "../lib/api-context.tsx";
import { useEffect, useState } from "react";
import { Link, useLocation } from "../lib/workspace-router.tsx";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "../components/ui/sidebar.tsx";
import { Field, FieldGroup, FieldLabel } from "../components/ui/field.tsx";
import { Input } from "../components/ui/input.tsx";
import { Alert, AlertDescription } from "../components/ui/alert.tsx";
import { Button } from "../components/ui/button.tsx";
import { ScrollArea } from "../components/ui/scroll-area.tsx";
import { BookOpenIcon, ChartNoAxesCombinedIcon, HouseIcon, LogOutIcon, UsersIcon } from "lucide-react";
import { useNavigationPreview } from "../features/settings/navigation-preview.tsx";
import { useAuth } from "../features/auth/AuthProvider.tsx";
import { ProfileIcon } from "../features/settings/profile.tsx";
import { accountPreferences, profileName } from "../features/settings/account-preferences.ts";
import { navigationSection } from "./navigation-section.ts";
import {
  settingsCategories,
  settingsCategoryCurrent,
  workspaceSettingsDestinations,
} from "../features/settings/SettingsNavigation.tsx";
import { useSettingsAccess } from "../features/settings/workspace-settings-access.tsx";
import { useWorkspaceCapabilities } from "../features/workspaces/workspace-context.tsx";
import { businessPath } from "../lib/workspace-route.tsx";
import { workspaceBase } from "../features/details/workspace-context.ts";

import type { EntityDetail } from "@contracts/entity.ts";
import {
  defaultNavigationRefs,
  entityTypeLocation,
  navigationEntryCurrent,
  resolveNavigationRefs,
  visibleNavigationEntries,
} from "./type-navigation.ts";
import { useEntityTypes } from "../features/entity/useEntityTypes.ts";
import { EntityTypeIcon } from "../features/entity/EntityTypeIcon.tsx";
/** Keep a keyboard-focused destination visible when viewport height or text size changes. */
function retainNavigationFocusVisibility(content: HTMLDivElement | null) {
  if (!content) return;
  let frame = 0;
  const observer = new ResizeObserver(() => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const active = content.ownerDocument.activeElement;
      if (!content.isConnected || !(active instanceof HTMLElement) || !content.contains(active)) return;
      const bounds = content.getBoundingClientRect(), focused = active.getBoundingClientRect();
      if (focused.top < bounds.top || focused.bottom > bounds.bottom) {
        active.scrollIntoView({ block: "nearest", inline: "nearest" });
      }
    });
  });
  observer.observe(content);
  for (const child of content.children) observer.observe(child);
  return () => {
    observer.disconnect();
    cancelAnimationFrame(frame);
  };
}

export function Navigation({ brand }: { brand: string }) {
  const api = useApi();
  const location = useLocation();
  const { session } = useAuth();
  const { workspaceId } = useRequestScope();
  const { canRead } = useSettingsAccess();
  const capability = useWorkspaceCapabilities();
  const catalog = useEntityTypes(location.key, !!workspaceId);
  const { preview } = useNavigationPreview();
  const preference = preview === undefined ? accountPreferences(session?.user.user_metadata ?? {}).navigation : preview;
  const entries = visibleNavigationEntries(resolveNavigationRefs(
    preference?.refs ?? defaultNavigationRefs(catalog.types ?? []),
    catalog.types ?? [],
  ));
  const [keyword, setKeyword] = useState("");
  const requestedTypeId = entityTypeLocation(location.search);
  const [detailType, setDetailType] = useState<{ path: string; id: string } | null>(null);
  const typeId = requestedTypeId ?? (detailType?.path === location.pathname ? detailType.id : null);
  useEffect(() => {
    const controller = new AbortController();
    if (!requestedTypeId && /^\/entities\/[^/]+$/.test(location.pathname)) {
      void api<EntityDetail>("GET", location.pathname, undefined, controller.signal).then((entity) => {
        if (!controller.signal.aborted) setDetailType({ path: location.pathname, id: entity.entity_type_id });
      }).catch(() => {});
    }
    return () => controller.abort();
  }, [location.pathname, requestedTypeId, session?.user.id]);
  const owner = location.pathname.startsWith("/settings") ? null : location.state?.workspaceOwner;
  const currentPath = typeof owner === "string" && workspaceBase(owner) ? owner : location.pathname;
  const current = navigationSection(currentPath);
  const isCurrent = (entry: (typeof entries)[number]) => navigationEntryCurrent(entry, current, typeId);
  const { isMobile, setOpenMobile } = useSidebar();
  useEffect(() => {
    setOpenMobile(false);
  }, [location.key, session?.user.id, setOpenMobile]);
  const builtin = resolveNavigationRefs(
    ["entities", "tasks", "records"].map((id) => ({
      kind: "builtin" as const,
      id: id as "entities" | "tasks" | "records",
    })),
    catalog.types ?? [],
  );
  const renderLink = (entry: (typeof entries)[number]) => (
    <SidebarMenuItem key={entry.key}>
      <SidebarMenuButton asChild isActive={isCurrent(entry)} className="min-h-[max(2.75rem,44px)]">
        <Link to={entry.to} aria-current={isCurrent(entry) ? "page" : undefined}>
          <EntityTypeIcon id={entry.icon} />
          <span>{entry.label}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
  const destinations = [{ to: "/status", label: "상태", icon: ChartNoAxesCombinedIcon }, {
    to: "/guide",
    label: "사용 가이드",
    icon: BookOpenIcon,
  }, { to: "/logout", label: "로그아웃", icon: LogOutIcon }];
  const renderDestination = (
    { to, label, icon: Icon }: { to: string; label: string; icon: typeof BookOpenIcon },
    active = currentPath === to,
    keepCurrent = false,
  ) => (
    <SidebarMenuItem key={to}>
      <SidebarMenuButton asChild isActive={active} className="min-h-[max(2.75rem,44px)]">
        <Link
          to={to}
          aria-current={active ? "page" : undefined}
          onClick={(event) => {
            if (
              event.button === 0 && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey &&
              (to === `${location.pathname}${location.search}${location.hash}` || keepCurrent && active)
            ) {
              event.preventDefault();
              setOpenMobile(false);
            }
          }}
        >
          <Icon />
          <span>{label}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
  const otherBuiltin = builtin.filter((entry) => !entries.some((pinned) => pinned.key === entry.key));
  const otherTypes = catalog.types?.filter((type) =>
    !entries.some((entry) => entry.ref.kind === "type" && entry.ref.id === type.id)
  );
  return (
    <Sidebar
      collapsible={isMobile ? "offcanvas" : "none"}
      className="h-full min-w-0"
      aria-label="주 메뉴"
      role="navigation"
      id="workspace-navigation"
    >
      <ScrollArea
        ref={retainNavigationFocusVisibility}
        className="min-h-0 min-w-0 flex-1 [&_[data-slot=scroll-area-viewport]>div]:block!"
      >
        {/* Keep one scroll owner so all destinations remain reachable at short heights and large text sizes. */}
        <div className="flex min-h-full w-full min-w-0 flex-col">
          <SidebarHeader>
            <WorkspaceSwitcher brand={brand} />
          </SidebarHeader>
          <SidebarContent className="flex-none overflow-visible">
            {workspaceId && (
              <>
                {!!entries.length && (
                  <SidebarGroup>
                    <SidebarGroupLabel>바로가기</SidebarGroupLabel>
                    <SidebarMenu>{entries.map(renderLink)}</SidebarMenu>
                  </SidebarGroup>
                )}
                {(!!otherBuiltin.length || !!otherTypes?.length || !!keyword || catalog.error) && (
                  <SidebarGroup aria-label="자료">
                    <SidebarGroupLabel>자료</SidebarGroupLabel>
                    <SidebarMenu>{otherBuiltin.map(renderLink)}</SidebarMenu>
                    {((otherTypes?.length ?? 0) > 6 || !!keyword) && (
                      <FieldGroup>
                        <Field>
                          <FieldLabel htmlFor="navigation-type-search">자료 종류 검색</FieldLabel>
                          <Input
                            id="navigation-type-search"
                            type="search"
                            value={keyword}
                            onChange={(event) => setKeyword(event.target.value)}
                          />
                        </Field>
                      </FieldGroup>
                    )}
                    <SidebarMenu>
                      {otherTypes?.filter((type) =>
                        type.label.toLocaleLowerCase().includes(keyword.toLocaleLowerCase())
                      ).map((type) => (
                        <SidebarMenuItem key={type.id}>
                          <SidebarMenuButton
                            asChild
                            className="min-h-[max(2.75rem,44px)]"
                            isActive={current === "entities" && typeId === type.id}
                          >
                            <Link
                              to={`/entities?entity_type_id=${type.id}`}
                              aria-current={current === "entities" && typeId === type.id ? "page" : undefined}
                            >
                              <EntityTypeIcon id={type.icon_id} />
                              <span>{type.label}{type.archived ? " · 보관" : ""}</span>
                            </Link>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      ))}
                    </SidebarMenu>
                    {catalog.error && (
                      <Alert variant="destructive">
                        <AlertDescription>자료 종류를 불러오지 못했습니다.</AlertDescription>
                        <Button variant="outline" onClick={catalog.retry}>다시 시도</Button>
                      </Alert>
                    )}
                  </SidebarGroup>
                )}
              </>
            )}
            <SidebarGroup>
              <SidebarGroupLabel>설정</SidebarGroupLabel>
              <SidebarMenu>
                {settingsCategories.filter((category) => workspaceId && canRead || category.to === "/settings").map(
                  (category) =>
                    renderDestination(
                      category,
                      settingsCategoryCurrent(currentPath, category.to),
                      category.to === "/settings/materials",
                    ),
                )}
              </SidebarMenu>
            </SidebarGroup>
            <SidebarGroup>
              <SidebarGroupLabel>공간</SidebarGroupLabel>
              <SidebarMenu>
                {workspaceSettingsDestinations(workspaceId, capability?.can_manage ?? false).map((destination) =>
                  renderDestination(
                    { ...destination, icon: destination.to === "/workspaces" ? UsersIcon : HouseIcon },
                    currentPath === businessPath(destination.to),
                  )
                )}
              </SidebarMenu>
            </SidebarGroup>
            <SidebarGroup>
              <SidebarGroupLabel>도움말</SidebarGroupLabel>
              <SidebarMenu>
                {destinations.filter((destination) => workspaceId || destination.to === "/logout").map((destination) =>
                  renderDestination(destination)
                )}
              </SidebarMenu>
            </SidebarGroup>
          </SidebarContent>
          <SidebarFooter className="mt-auto">
            <div role="group" aria-label="내 프로필" className="flex min-h-12 min-w-0 items-center gap-2 px-2">
              <ProfileIcon id={session?.user.user_metadata?.workspace_avatar_id} />
              <span className="min-w-0 flex-1 truncate">{profileName(session?.user.user_metadata)}</span>
            </div>
          </SidebarFooter>
        </div>
      </ScrollArea>
    </Sidebar>
  );
}

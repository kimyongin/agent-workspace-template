import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router";
import { useSidebar, Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "../components/ui/sidebar.tsx";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "../components/ui/dropdown-menu.tsx";
import { Field, FieldGroup, FieldLabel } from "../components/ui/field.tsx";
import { Input } from "../components/ui/input.tsx";
import { Alert, AlertDescription } from "../components/ui/alert.tsx";
import { Button } from "../components/ui/button.tsx";
import { BookOpenIcon, ChartNoAxesCombinedIcon, ChevronsUpDownIcon, LogOutIcon, SettingsIcon, XIcon } from "lucide-react";
import { useNavigationPreview } from "../features/settings/navigation-preview.tsx";
import { useAuth } from "../features/auth/AuthProvider.tsx";
import { ProfileIcon } from "../features/settings/profile.tsx";
import { accountPreferences, profileName } from "../features/settings/account-preferences.ts";
import { navigationSection } from "./navigation-section.ts";
import { workspaceBase } from "../features/details/workspace-context.ts";
import appIcon from "./app-icon.svg";
import { api } from "../lib/api.ts";
import type { EntityDetail } from "@contracts/entity.ts";
import { defaultNavigationRefs, entityTypeLocation, navigationEntryCurrent, resolveNavigationRefs, visibleNavigationEntries } from "./type-navigation.ts";
import { useEntityTypes } from "../features/entity/useEntityTypes.ts";
import { EntityTypeIcon } from "../features/entity/EntityTypeIcon.tsx";
// Keep the existing focused item reachable when the open profile menu reflows.
function retainProfileFocusVisibility(content: HTMLDivElement | null) {
  if (!content) return;
  let frame = 0;
  const observer = new ResizeObserver(() => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      if (!content.isConnected || content.dataset.state !== "open") return;
      const active = content.ownerDocument.activeElement;
      if (!(active instanceof HTMLElement) || !content.contains(active)) return;
      const item = active.closest<HTMLElement>('[role="menuitem"]');
      if (!item || !content.contains(item)) return;
      const bounds = content.getBoundingClientRect(), focused = item.getBoundingClientRect();
      if (focused.top < bounds.top || focused.bottom > bounds.bottom) {
        item.scrollIntoView({ block: "nearest", inline: "nearest" });
      }
    });
  });
  observer.observe(content);
  for (const child of content.children) observer.observe(child);
  return () => { observer.disconnect(); cancelAnimationFrame(frame); };
}

export function Navigation({ brand }: { brand: string }) {
  const location = useLocation();
  const { session } = useAuth();
  const catalog = useEntityTypes(location.key);
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
  useEffect(() => { setOpenMobile(false); }, [location.key, session?.user.id, setOpenMobile]);
  const builtin = resolveNavigationRefs(["entities", "tasks", "records"].map(id => ({ kind: "builtin" as const, id: id as "entities" | "tasks" | "records" })), catalog.types ?? []);
  const renderLink = (entry: (typeof entries)[number]) => <SidebarMenuItem key={entry.key}><SidebarMenuButton asChild isActive={isCurrent(entry)} className="min-h-[max(2.75rem,44px)]"><Link to={entry.to} aria-current={isCurrent(entry) ? "page" : undefined}><EntityTypeIcon id={entry.icon} /><span>{entry.label}</span></Link></SidebarMenuButton></SidebarMenuItem>;
  const destinations = [{ to: "/status", label: "상태", icon: ChartNoAxesCombinedIcon }, { to: "/settings", label: "설정", icon: SettingsIcon }, { to: "/guide", label: "사용 가이드", icon: BookOpenIcon }, { to: "/logout", label: "로그아웃", icon: LogOutIcon }];
  return <Sidebar collapsible={isMobile ? "offcanvas" : "none"} className="h-full min-w-0" aria-label="주 메뉴" role="navigation" id="workspace-navigation">
    <SidebarHeader>{isMobile && <Button variant="ghost" size="icon" aria-label="메뉴 닫기" className="self-end" onClick={() => setOpenMobile(false)}><XIcon /></Button>}<SidebarMenu><SidebarMenuItem><SidebarMenuButton asChild className="min-h-12"><Link to="/entities"><img className="size-6 shrink-0" src={appIcon} alt="" /><span>{brand}</span></Link></SidebarMenuButton></SidebarMenuItem></SidebarMenu></SidebarHeader>
    <SidebarContent>
      {!!entries.length && <SidebarGroup><SidebarGroupLabel>바로가기</SidebarGroupLabel><SidebarMenu>{entries.map(renderLink)}</SidebarMenu></SidebarGroup>}
      <SidebarGroup><SidebarGroupLabel>업무</SidebarGroupLabel><SidebarMenu>{builtin.filter(entry => !entries.some(pinned => pinned.key === entry.key)).map(renderLink)}</SidebarMenu></SidebarGroup>
      <SidebarGroup><SidebarGroupLabel>자료 종류</SidebarGroupLabel>
        {(catalog.types?.length ?? 0) > 6 && <FieldGroup><Field><FieldLabel htmlFor="navigation-type-search">자료 종류 검색</FieldLabel><Input id="navigation-type-search" type="search" value={keyword} onChange={event => setKeyword(event.target.value)} /></Field></FieldGroup>}
        <SidebarMenu>{catalog.types?.filter(type => !entries.some(entry => entry.to === `/entities?entity_type_id=${type.id}`) && type.label.toLocaleLowerCase().includes(keyword.toLocaleLowerCase())).map(type => <SidebarMenuItem key={type.id}><SidebarMenuButton asChild className="min-h-[max(2.75rem,44px)]" isActive={current === "entities" && typeId === type.id}><Link to={`/entities?entity_type_id=${type.id}`} aria-current={current === "entities" && typeId === type.id ? "page" : undefined}><EntityTypeIcon id={type.icon_id} /><span>{type.label}{type.archived ? " · 보관" : ""}</span></Link></SidebarMenuButton></SidebarMenuItem>)}</SidebarMenu>
        {catalog.error && <Alert variant="destructive"><AlertDescription>자료 종류를 불러오지 못했습니다.</AlertDescription><Button variant="outline" onClick={catalog.retry}>다시 시도</Button></Alert>}
      </SidebarGroup>
    </SidebarContent>
    <SidebarFooter><DropdownMenu><DropdownMenuTrigger asChild><SidebarMenuButton className="min-h-12" aria-label="내 프로필"><ProfileIcon id={session?.user.user_metadata?.workspace_avatar_id} /><span className="min-w-0 flex-1 truncate">{profileName(session?.user.user_metadata)}</span><ChevronsUpDownIcon /></SidebarMenuButton></DropdownMenuTrigger>
      <DropdownMenuContent ref={retainProfileFocusVisibility} side={isMobile ? "bottom" : "right"} align="end"><DropdownMenuLabel>{profileName(session?.user.user_metadata)}</DropdownMenuLabel><DropdownMenuSeparator /><DropdownMenuGroup>{destinations.map(({ to, label, icon: Icon }) => <DropdownMenuItem asChild key={to}><Link to={to}><Icon /><span>{label}</span></Link></DropdownMenuItem>)}</DropdownMenuGroup></DropdownMenuContent>
    </DropdownMenu></SidebarFooter>
  </Sidebar>;
}

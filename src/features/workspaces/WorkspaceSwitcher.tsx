import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import type { Workspace } from "@contracts/workspace.ts";
import { useApi, useRequestScope } from "../../lib/api-context.tsx";
import { workspacePath } from "../../lib/workspace-route.tsx";
import { useWorkspaceCapabilities } from "./workspace-context.tsx";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "../../components/ui/sidebar.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu.tsx";
import { CheckIcon, ChevronsUpDownIcon, PanelsTopLeftIcon } from "lucide-react";
import { Spinner } from "../../components/ui/spinner.tsx";
export function WorkspaceSwitcher() {
  const api = useApi(),
    { workspaceId } = useRequestScope(),
    location = useLocation();
  const current = useWorkspaceCapabilities()?.workspace;
  const [items, setItems] = useState<Workspace[]>([]),
    [failed, setFailed] = useState(false),
    [loading, setLoading] = useState(true),
    [revision, setRevision] = useState(0);
  const content = useRef<HTMLDivElement>(null), retryIntent = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const restoreRetryFocus = retryIntent.current;
    retryIntent.current = null;
    setLoading(true);
    void api<{ items: Workspace[] }>(
      "GET",
      "/workspaces",
      undefined,
      controller.signal,
    ).then((value) => {
      if (!controller.signal.aborted) {
        const restore = restoreRetryFocus && document.activeElement === restoreRetryFocus;
        setItems(value.items);
        setFailed(false);
        if (restore) {
          requestAnimationFrame(() => {
            const menu = content.current;
            if (controller.signal.aborted || menu?.dataset.state !== "open" || !document.hasFocus()) return;
            if (
              document.activeElement !== document.body && document.activeElement !== menu &&
              document.activeElement !== restoreRetryFocus
            ) return;
            (menu.querySelector<HTMLElement>('[aria-current="page"]') ??
              menu.querySelector<HTMLElement>('a[role="menuitem"]') ?? menu).focus();
          });
        }
      }
    }).catch(() => {
      if (!controller.signal.aborted) setFailed(true);
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [api, location.key, revision]);
  const name = items.find((item) => item.id === workspaceId)?.name ?? current?.name ?? "공간 선택";
  return (
    <SidebarMenu className="@container/workspace-picker">
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton aria-label="공간 선택" aria-description={name} className="min-h-12">
              <PanelsTopLeftIcon aria-hidden="true" className="hidden @min-[10rem]/workspace-picker:block" />
              <span className="min-w-0 flex-1 truncate" title={name}>
                {name}
              </span>
              <ChevronsUpDownIcon aria-hidden="true" className="hidden @min-[10rem]/workspace-picker:block" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" ref={content} aria-busy={loading}>
            <DropdownMenuGroup>
              <DropdownMenuLabel>내 공간</DropdownMenuLabel>
              {!loading && !failed && !items.length && (
                <DropdownMenuLabel role="status" className="whitespace-normal">
                  참여 중인 공간이 없습니다.
                </DropdownMenuLabel>
              )}
              {items.map((item) => (
                <DropdownMenuItem key={item.id} asChild>
                  <Link
                    to={workspacePath(item.id)}
                    aria-current={item.id === workspaceId ? "page" : undefined}
                  >
                    <span className="min-w-0 flex-1 whitespace-normal wrap-anywhere">{item.name}</span>
                    {item.id === workspaceId && <CheckIcon />}
                  </Link>
                </DropdownMenuItem>
              ))}
              {failed && (
                <DropdownMenuItem
                  aria-label="목록 다시 불러오기"
                  disabled={loading}
                  onSelect={(event) => {
                    event.preventDefault();
                    if (loading) return;
                    retryIntent.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
                    setLoading(true);
                    setRevision((value) => value + 1);
                  }}
                >
                  {loading
                    ? (
                      <>
                        <Spinner aria-hidden="true" data-icon="inline-start" />
                        <span role="status">목록 불러오는 중…</span>
                      </>
                    )
                    : "목록 다시 불러오기"}
                </DropdownMenuItem>
              )}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

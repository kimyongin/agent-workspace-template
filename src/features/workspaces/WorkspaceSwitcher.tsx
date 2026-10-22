import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router";
import type { Workspace } from "@contracts/workspace.ts";
import { useApi, useRequestScope } from "../../lib/api-context.tsx";
import { workspacePath } from "../../lib/workspace-route.tsx";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "../../components/ui/sidebar.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu.tsx";
import { CheckIcon, ChevronsUpDownIcon, PanelsTopLeftIcon } from "lucide-react";
export function WorkspaceSwitcher({ brand }: { brand: string }) {
  const api = useApi(),
    { workspaceId } = useRequestScope(),
    location = useLocation();
  const [items, setItems] = useState<Workspace[]>([]),
    [failed, setFailed] = useState(false),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void api<{ items: Workspace[] }>(
      "GET",
      "/workspaces",
      undefined,
      controller.signal,
    ).then((value) => {
      if (!controller.signal.aborted) {
        setItems(value.items);
        setFailed(false);
      }
    }).catch(() => {
      if (!controller.signal.aborted) setFailed(true);
    });
    return () => controller.abort();
  }, [api, location.key, revision]);
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton aria-label="공간 선택" className="min-h-12">
              <PanelsTopLeftIcon aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">
                {items.find((item) => item.id === workspaceId)?.name ??
                  brand}
              </span>
              <ChevronsUpDownIcon />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuGroup>
              <DropdownMenuLabel>내 공간</DropdownMenuLabel>
              {items.map((item) => (
                <DropdownMenuItem key={item.id} asChild>
                  <Link
                    to={workspacePath(item.id)}
                    aria-current={item.id === workspaceId ? "page" : undefined}
                  >
                    <span className="max-w-64 truncate">{item.name}</span>
                    {item.id === workspaceId && <CheckIcon />}
                  </Link>
                </DropdownMenuItem>
              ))}
              {failed && (
                <DropdownMenuItem
                  onSelect={() => setRevision((value) => value + 1)}
                >
                  목록 다시 불러오기
                </DropdownMenuItem>
              )}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

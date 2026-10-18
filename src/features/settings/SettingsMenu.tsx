import { hasActiveConfirmation } from "../../lib/surface-dom.ts";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "../../lib/workspace-router.tsx";
import { MenuIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { settingsCategories } from "./SettingsNavigation.tsx";

export function SettingsMenu() {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const location = useLocation();
  useEffect(() => { setOpen(false); }, [location.pathname, location.search, location.hash]);
  if (!location.pathname.startsWith("/settings")) return null;
  const current = (path: string) =>
    location.pathname === path || path !== "/settings" && location.pathname.startsWith(`${path}/`) ||
    path === "/settings/materials" && ["/settings/entity-types", "/settings/relations", "/settings/issuers", "/settings/data-model"]
      .some((prefix) => location.pathname === prefix || location.pathname.startsWith(`${prefix}/`));
  return <DropdownMenu modal={false} open={open} onOpenChange={setOpen}>
    <DropdownMenuTrigger asChild><Button type="button" variant="outline" size="icon" ref={trigger} aria-label="설정 메뉴"><MenuIcon /></Button></DropdownMenuTrigger>
    <DropdownMenuContent loop aria-label="설정 메뉴" align="end" onCloseAutoFocus={event => {
      const focused = document.activeElement;
      if (focused === document.body || event.target instanceof HTMLElement && event.target.contains(focused)) {
        event.preventDefault(); trigger.current?.focus();
      }
    }} onInteractOutside={event => { if (hasActiveConfirmation()) event.preventDefault(); }}>
      <DropdownMenuGroup>
        {settingsCategories.map(({ to, label }) => <DropdownMenuItem key={to} asChild onSelect={event => event.preventDefault()}>
          <Link to={to} aria-current={current(to) ? "page" : undefined} onClick={event => {
            if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey &&
              (to === `${location.pathname}${location.search}${location.hash}` || to === "/settings/materials" && current(to))) {
              event.preventDefault(); setOpen(false); trigger.current?.focus();
            }
          }}>{label}</Link>
        </DropdownMenuItem>)}
      </DropdownMenuGroup>
    </DropdownMenuContent>
  </DropdownMenu>;
}

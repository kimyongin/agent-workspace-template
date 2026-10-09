import { useEffect, useRef, useState, type Ref } from "react";
import { Link, useLocation } from "react-router";
import { useAuth } from "../features/auth/AuthProvider.tsx";
import { ProfileIcon } from "../features/settings/profile.tsx";
import { profileName } from "../features/settings/account-preferences.ts";

import { navigationSection } from "./navigation-section.ts";
import appIcon from "./app-icon.svg";
const entries = [
  ["entities", "/entities", "엔터티", "M3 3h7v7H3ZM14 3h7v7h-7ZM3 14h7v7H3ZM14 14h7v7h-7Z"],
  ["tasks", "/tasks", "할 일", "m3 12 3 3 5-6M14 6h7M14 12h7M14 18h7"],
  ["principles", "/principles", "원칙", "M5 3h14v18H5ZM8 7h8M8 11h8M8 15h5"],
  ["records", "/records", "기록", "M5 3h14v18H5ZM8 7h8M8 11h8M8 15h5"],
] as const;
const popoverIcons = {
  "/guide": <path d="M4 4h6l2 2 2-2h6v16h-6l-2 2-2-2H4ZM12 6v16"/>,
  "/settings": <><path d="M19.39 8.94L19.83 10.34L21.88 10.44L21.88 13.56L19.83 13.66L19.39 15.06L18.71 16.36L20.09 17.88L17.88 20.09L16.36 18.71L15.06 19.39L13.66 19.83L13.56 21.88L10.44 21.88L10.34 19.83L8.94 19.39L7.64 18.71L6.12 20.09L3.91 17.88L5.29 16.36L4.61 15.06L4.17 13.66L2.12 13.56L2.12 10.44L4.17 10.34L4.61 8.94L5.29 7.64L3.91 6.12L6.12 3.91L7.64 5.29L8.94 4.61L10.34 4.17L10.44 2.12L13.56 2.12L13.66 4.17L15.06 4.61L16.36 5.29L17.88 3.91L20.09 6.12L18.71 7.64Z"/><circle cx="12" cy="12" r="3"/></>,
  "/logout": <><path d="M9 4H4v16h5M10 12h10m-4-4 4 4-4 4"/></>,
};
function PopoverLink({ to, label }: { to: keyof typeof popoverIcons; label: string }) {
  return <Link to={to} className={to === "/logout" ? "nav-logout" : undefined}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {popoverIcons[to]}
  </svg><span>{label}</span></Link>;
}
export function Navigation({ brand, navigationRef }: { brand: string; navigationRef?: Ref<HTMLElement> }) {
  const location = useLocation();
  const { session } = useAuth();
  const owner = location.state?.workspaceOwner;
  const current = navigationSection(typeof owner === "string" && /^\/(entities|tasks|records|principles|search)$/.test(owner) ? owner : location.pathname);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const profileTrigger = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const close = (restore = false) => {
    setOpen(false); if (restore) profileTrigger.current?.focus();
  };
  useEffect(() => { setOpen(false); }, [location, session?.user.id]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest("dialog[open]")) return;
      if (!root.current?.contains(event.target as Node)) close(true);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  return <nav className="bottom-nav" aria-label="주 메뉴" id="workspace-navigation" ref={navigationRef}>
    <div className="navigation-brand"><img src={appIcon} alt=""/><span>{brand}</span></div>
    <div className="bottom-nav-inner" ref={root} onBlur={event => {
      if (event.relatedTarget instanceof Element && event.relatedTarget.closest("dialog[open]")) return;
      if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false);
    }} onKeyDown={event => {
      if (event.key === "Escape" && open) { event.preventDefault(); close(true); }
      if (open && ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        const items = Array.from(popover.current?.querySelectorAll<HTMLElement>("a, button:not(:disabled)") ?? []);
        if (!items.length) return;
        event.preventDefault();
        const index = items.indexOf(document.activeElement as HTMLElement);
        const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
          : event.key === "ArrowDown" ? (index + 1) % items.length : (index - 1 + items.length) % items.length;
        items[next].focus();
      }
    }}>
      <div className="nav-profile"><button className="nav-profile-trigger" type="button" ref={profileTrigger} aria-label="내 프로필" aria-expanded={open} aria-controls="nav-profile-options" data-current={current === "more" || undefined}
        onClick={() => setOpen(value => !value)}><ProfileIcon id={session?.user.user_metadata?.workspace_avatar_id} /><span className="nav-control-label">내 계정</span></button>
        {open && <div className="nav-profile-options" id="nav-profile-options" ref={popover}>
          <div className="nav-profile-identity"><ProfileIcon id={session?.user.user_metadata?.workspace_avatar_id} /><p>{profileName(session?.user.user_metadata)}</p></div>
          <PopoverLink to="/settings" label="설정"/>
          <PopoverLink to="/guide" label="사용 가이드"/>
          <PopoverLink to="/logout" label="로그아웃"/>
        </div>}</div>
      {entries.map(([key, to, label, path]) => <Link key={key} to={to} aria-current={current === key ? "page" : undefined}>
        <svg className="navigation-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={path} /></svg><span>{label}</span></Link>)}
    </div>
  </nav>;
}

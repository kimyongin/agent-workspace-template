import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import { useAuth } from "../features/auth/AuthProvider.tsx";
import { ProfileIcon } from "../features/settings/profile.tsx";
import { profileName } from "../features/settings/account-preferences.ts";

import { navigationSection } from "./navigation-section.ts";
const entries = [
  ["entities", "/entities", "엔터티", "M3 3h7v7H3ZM14 3h7v7h-7ZM3 14h7v7H3ZM14 14h7v7h-7Z"],
  ["tasks", "/tasks", "할 일", "m3 12 3 3 5-6M14 6h7M14 12h7M14 18h7"],
  ["principles", "/principles", "원칙", "M5 3h14v18H5ZM8 7h8M8 11h8M8 15h5"],
  ["records", "/records", "기록", "M5 3h14v18H5ZM8 7h8M8 11h8M8 15h5"],
] as const;
export function Navigation({ brand }: { brand: string }) {
  const location = useLocation();
  const { session } = useAuth();
  const current = navigationSection(location.pathname);
  const [open, setOpen] = useState<"profile" | "menu" | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const profileTrigger = useRef<HTMLButtonElement>(null);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const close = (restore = false) => {
    const trigger = open === "profile" ? profileTrigger : menuTrigger;
    setOpen(null); if (restore) trigger.current?.focus();
  };
  useEffect(() => { setOpen(null); }, [location, session?.user.id]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest("dialog[open]")) return;
      if (!root.current?.contains(event.target as Node)) close(true);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  return <nav className="bottom-nav" aria-label="주 메뉴">
    <div className="navigation-brand">{brand}</div>
    <div className="bottom-nav-inner" ref={root} onBlur={event => {
      if (event.relatedTarget instanceof Element && event.relatedTarget.closest("dialog[open]")) return;
      if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) setOpen(null);
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
      <div className="nav-more nav-profile"><button className="nav-more-trigger" type="button" ref={profileTrigger} aria-label="내 프로필" aria-expanded={open === "profile"} aria-controls="nav-profile-options"
        onClick={() => setOpen(value => value === "profile" ? null : "profile")}><ProfileIcon id={session?.user.user_metadata?.workspace_avatar_id} /><span className="nav-control-label">내 계정</span></button>
        {open === "profile" && <div className="nav-more-options" id="nav-profile-options" ref={popover}>
          <div className="nav-profile-identity"><ProfileIcon id={session?.user.user_metadata?.workspace_avatar_id} /><p>{profileName(session?.user.user_metadata)}</p></div>
          <Link to="/settings"><svg className="navigation-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m12 3 2 2 3-.2 1 3 3 2-1 3 .2 3-3 1-2 3-3-1-3 .2-1-3-3-2 1-3L5 7l3-1Z" /><circle cx="12" cy="12" r="3" /></svg>설정</Link>
        </div>}</div>
      {entries.map(([key, to, label, path]) => <Link key={key} to={to} aria-current={current === key ? "page" : undefined}>
        <svg className="navigation-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={path} /></svg><span>{label}</span></Link>)}
      <div className="nav-more"><button className="nav-more-trigger" type="button" ref={menuTrigger} aria-label="메뉴" aria-expanded={open === "menu"} aria-controls="nav-more-options" data-current={current === "more" || undefined}
        onClick={() => setOpen(value => value === "menu" ? null : "menu")}><svg className="navigation-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" /></svg><span className="nav-control-label">메뉴</span></button>
        {open === "menu" && <div className="nav-more-options" id="nav-more-options" ref={popover}><Link to="/guide">사용 가이드</Link><Link to="/settings">설정</Link></div>}</div>
    </div>
  </nav>;
}

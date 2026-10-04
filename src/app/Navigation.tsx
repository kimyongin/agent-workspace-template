import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router";

export function navigationSection(path: string) {
  if (/^\/entities(?:\/|$)/.test(path)) return "entities";
  if (/^\/(tasks|records)(?:\/|$)/.test(path)) return "activity";
  if (/^\/principles(?:\/|$)/.test(path)) return "principles";
  if (/^\/search(?:\/|$)/.test(path)) return "search";
  if (/^\/(tags|guide)(?:\/|$)/.test(path)) return "more";
  return null;
}

const entries = [["entities", "/entities", "엔터티"], ["activity", "/tasks", "활동"],
  ["principles", "/principles", "원칙"], ["search", "/search", "검색"]] as const;

export function Navigation() {
  const location = useLocation();
  const current = navigationSection(location.pathname);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => { setOpen(false); }, [location]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  return <nav className="bottom-nav" aria-label="주 메뉴">
    <div className="bottom-nav-inner">
      {entries.map(([key, to, label]) => <Link key={key} to={to}
        aria-current={current === key ? "page" : undefined}>{label}</Link>)}
      <div className="nav-more" ref={root} onBlur={event => {
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false);
      }} onKeyDown={event => {
        if (event.key === "Escape" && open) {
          event.preventDefault(); setOpen(false); trigger.current?.focus();
        }
        if (open && ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          const items = Array.from(menu.current?.querySelectorAll<HTMLElement>("a, button:not(:disabled)") ?? []);
          if (!items.length) return;
          event.preventDefault();
          const index = items.indexOf(document.activeElement as HTMLElement);
          const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
            : event.key === "ArrowDown" ? (index + 1) % items.length : (index - 1 + items.length) % items.length;
          items[next].focus();
        }
      }}>
        <button className="nav-more-trigger" type="button" ref={trigger} aria-expanded={open}
          aria-controls="nav-more-options" data-current={current === "more" || undefined}
          onClick={() => setOpen(value => !value)}>더보기</button>
        {open && <div className="nav-more-options" id="nav-more-options" ref={menu}>
          <Link to="/tags" aria-current={location.pathname === "/tags" ? "page" : undefined}>태그 관리</Link>
          <Link to="/guide" aria-current={location.pathname === "/guide" ? "page" : undefined}>사용 가이드</Link>
          <Link to="/logout">로그아웃</Link>
        </div>}
      </div>
    </div>
  </nav>;
}

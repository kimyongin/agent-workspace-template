import { useEffect, useId, useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import { settingsCategories } from "./SettingsNavigation.tsx";
import "./settings.css";

export function SettingsMenu() {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const location = useLocation();
  useEffect(() => {
    setOpen(false);
  }, [location]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  if (!location.pathname.startsWith("/settings")) return null;
  const current = (path: string) =>
    location.pathname === path || path !== "/settings" && location.pathname.startsWith(`${path}/`) ||
    path === "/settings/materials" && location.pathname.startsWith("/settings/entity-types");
  return (
    <div
      className="settings-menu"
      ref={root}
      onBlur={(event) => {
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          setOpen(false);
          trigger.current?.focus();
        }
      }}
    >
      <button
        type="button"
        className="btn settings-menu-trigger"
        ref={trigger}
        aria-label="설정 메뉴"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((value) => !value)}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>
      {open && (
        <nav id={menuId} className="settings-menu-options" aria-label="설정 메뉴">
          {settingsCategories.map(({ to, label }) => (
            <Link key={to} to={to} aria-current={current(to) ? "page" : undefined}>{label}</Link>
          ))}
        </nav>
      )}
    </div>
  );
}

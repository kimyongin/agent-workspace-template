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
  }, [location.pathname, location.search, location.hash]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!document.querySelector("dialog.modal-confirm[open]") && !root.current?.contains(event.target as Node)) {
        setOpen(false);
      }
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
        if (
          !document.querySelector("dialog.modal-confirm[open]") && event.relatedTarget &&
          !event.currentTarget.contains(event.relatedTarget as Node)
        ) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          setOpen(false);
          trigger.current?.focus();
          return;
        }
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        if (!open) {
          setOpen(true);
          requestAnimationFrame(() => {
            const links = root.current?.querySelectorAll<HTMLAnchorElement>("nav a");
            const index = event.key === "ArrowUp" || event.key === "End" ? (links?.length ?? 1) - 1 : 0;
            links?.[index]?.focus();
          });
          return;
        }
        const links = Array.from(root.current?.querySelectorAll<HTMLAnchorElement>("nav a") ?? []);
        if (!links.length) return;
        const index = links.indexOf(document.activeElement as HTMLAnchorElement);
        const next = event.key === "Home"
          ? 0
          : event.key === "End"
          ? links.length - 1
          : event.key === "ArrowDown"
          ? (index + 1) % links.length
          : (index < 0 ? links.length - 1 : (index - 1 + links.length) % links.length);
        links[next]?.focus();
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
            <Link
              key={to}
              to={to}
              aria-current={current(to) ? "page" : undefined}
              onClick={(event) => {
                if (
                  event.button === 0 && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey &&
                  to === `${location.pathname}${location.search}${location.hash}`
                ) {
                  event.preventDefault();
                  setOpen(false);
                  trigger.current?.focus();
                }
              }}
            >
              {label}
            </Link>
          ))}
        </nav>
      )}
    </div>
  );
}

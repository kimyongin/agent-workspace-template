import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import { settingsCategories } from "./SettingsNavigation.tsx";
import "./settings.css";
export function SettingsMenu() {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const location = useLocation();
  useEffect(() => { setOpen(false); }, [location]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  return <div className="settings-menu" ref={root} onBlur={event => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false); }} onKeyDown={event => { if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); } }}>
    <button type="button" className="btn" ref={trigger} aria-label="설정 메뉴" aria-expanded={open} aria-controls="settings-menu-options" onClick={() => setOpen(value => !value)}>설정</button>
    {open && <nav id="settings-menu-options" className="settings-menu-options" aria-label="설정 메뉴">{settingsCategories.map(({ to, label }) => <Link key={to} to={to}>{label}</Link>)}</nav>}
  </div>;
}

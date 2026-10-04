import { useEffect, useId, useRef, useState } from "react";
import { Link, useLocation } from "react-router";
type Action = { label: string; run?: () => void; to?: string; onClick?: React.MouseEventHandler<HTMLAnchorElement>; disabled?: boolean };
export function TabActions({ title, actions }: { title: string; actions: Action[] }) {
  const [open, setOpen] = useState(false), id = useId(), location = useLocation();
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const close = (restore = false) => { setOpen(false); if (restore) trigger.current?.focus(); };
  useEffect(() => setOpen(false), [location]);
  useEffect(() => { if (!open) return; const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) close(true); };
    document.addEventListener("pointerdown", outside); return () => document.removeEventListener("pointerdown", outside); }, [open]);
  return <div className="tab-actions" ref={root} onBlur={event => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false); }} onKeyDown={event => {
    if (event.key === "Escape") { event.preventDefault(); close(true); }
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      const nodes = Array.from(root.current?.querySelectorAll<HTMLElement>(".tab-action-options a,.tab-action-options button:not(:disabled)") ?? []);
      if (!nodes.length) { setOpen(true); return; } event.preventDefault(); const at = nodes.indexOf(document.activeElement as HTMLElement);
      nodes[event.key === "Home" ? 0 : event.key === "End" ? nodes.length - 1 : event.key === "ArrowDown" ? (at + 1) % nodes.length : (at - 1 + nodes.length) % nodes.length].focus();
    }
  }}><button type="button" ref={trigger} className="tab-action-trigger" aria-label={`${title} 작업 메뉴`} aria-expanded={open} aria-controls={id}
    onClick={() => setOpen(value => !value)}><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg></button>
    {open && <div className="tab-action-options" id={id}>{actions.map(action => action.to ? <Link key={action.label} to={action.to} onClick={event => { close(); action.onClick?.(event); }}>{action.label}</Link>
      : <button key={action.label} type="button" disabled={action.disabled} onClick={() => { close(true); action.run?.(); }}>{action.label}</button>)}</div>}
  </div>;
}

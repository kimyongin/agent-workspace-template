import { useEffect, useId, useRef, useState, type DragEvent } from "react";

type Tab = { id: string; title: string };
type Placement = { id: string; before: boolean };
const icons: Record<string, string> = { entities: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z", tasks: "m3 12 3 3 5-6M14 6h7M14 12h7M14 18h7", records: "M5 3h14v18H5zM8 7h8M8 11h8M8 15h5" };

/** The strip owns drag presentation and keyboard interaction; the workspace owns tab order and visits. */
export function DetailTabs({ tabs, active, enabled, isBusy, select, close, reorder }: {
  tabs: Tab[]; active: string | null; enabled: boolean; isBusy: () => boolean;
  select: (id: string) => void; close: (id: string) => void;
  reorder: (id: string, target: string, before: boolean) => number | null;
}) {
  const help = useId();
  const source = useRef<string | null>(null);
  const frame = useRef<number | null>(null);
  const [drag, setDrag] = useState<{ id: string; placement: Placement | null } | null>(null);
  const [notice, setNotice] = useState("");
  const finish = () => { source.current = null; setDrag(null); };
  useEffect(() => { if (!enabled && source.current) finish(); }, [enabled]);
  useEffect(() => () => { if (frame.current !== null) cancelAnimationFrame(frame.current); }, []);
  const focus = () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const button = document.getElementById(`tab-${active}`);
      button?.focus({ preventScroll: true }); button?.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
  };
  const move = (id: string, placement: Placement) => {
    const position = reorder(id, placement.id, placement.before);
    if (position !== null) setNotice(`${tabs.find(tab => tab.id === id)?.title} 탭을 ${position + 1}번째로 이동했습니다.`);
    focus();
  };
  const placement = (event: DragEvent<HTMLDivElement>): Placement | null => {
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("[data-tab-id]"));
    const next = items.find(item => event.clientX < item.getBoundingClientRect().left + item.getBoundingClientRect().width / 2);
    const target = next ?? items.at(-1);
    return target?.dataset.tabId ? { id: target.dataset.tabId, before: !!next } : null;
  };
  return <>
    <span className="visually-hidden" id={help}>탭 제목을 드래그하거나 Ctrl+Shift+좌우 방향키로 순서를 바꿉니다.</span>
    <span className="visually-hidden" role="status">{notice}</span>
    <div className="workspace-tabs" role="tablist" aria-label="열린 상세" onKeyDown={event => {
      if (!(event.target instanceof Element) || !event.target.closest("[role=tab]")) return;
      if (event.key === "Escape" && source.current) { finish(); focus(); return; }
      if (!enabled || isBusy()) return;
      const index = tabs.findIndex(tab => tab.id === active);
      if (index < 0) return;
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && ["ArrowLeft", "ArrowRight"].includes(event.key)) {
        event.preventDefault();
        const neighbor = tabs[index + (event.key === "ArrowRight" ? 1 : -1)];
        if (neighbor) move(tabs[index].id, { id: neighbor.id, before: event.key === "ArrowLeft" });
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey || !["ArrowLeft", "ArrowRight", "Home", "End", "Delete"].includes(event.key)) return;
      event.preventDefault();
      if (event.key === "Delete") { close(tabs[index].id); return; }
      const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
      select(tabs[next].id);
    }} onDragOver={event => {
      if (!source.current || !enabled || isBusy()) return;
      event.preventDefault(); event.dataTransfer.dropEffect = "move";
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left + 28) event.currentTarget.scrollLeft -= 24;
      else if (event.clientX > bounds.right - 28) event.currentTarget.scrollLeft += 24;
      setDrag({ id: source.current, placement: placement(event) });
    }} onDrop={event => {
      if (!source.current) return;
      event.preventDefault();
      const id = source.current, target = placement(event);
      finish();
      if (enabled && !isBusy() && target) move(id, target);
    }}>{tabs.map(tab => <div className="workspace-tab" key={tab.id} data-tab-id={tab.id} data-selected={active === tab.id || undefined}
      data-dragging={drag?.id === tab.id || undefined} data-drop={drag?.placement?.id === tab.id && drag.id !== tab.id ? drag.placement.before ? "before" : "after" : undefined}>
      <button role="tab" id={`tab-${tab.id}`} aria-selected={active === tab.id} aria-controls={`panel-${tab.id}`} aria-describedby={help}
        aria-keyshortcuts="Control+Shift+ArrowLeft Control+Shift+ArrowRight" tabIndex={active === tab.id ? 0 : -1} title={tab.title}
        draggable={enabled} onClick={() => select(tab.id)} onDragStart={event => {
          if (!enabled || isBusy()) { event.preventDefault(); return; }
          source.current = tab.id; setDrag({ id: tab.id, placement: null });
          event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("application/x-workspace-tab", tab.id);
        }} onDragEnd={finish}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d={icons[tab.id.split("/")[1]]}/></svg><span>{tab.title}</span>
      </button><button className="workspace-tab-close" tabIndex={active === tab.id ? 0 : -1} aria-label={`${tab.title} 탭 닫기`} onClick={() => close(tab.id)}>×</button>
    </div>)}</div>
  </>;
}

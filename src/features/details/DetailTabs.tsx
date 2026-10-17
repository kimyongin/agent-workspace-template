import { TabsList, TabsTrigger } from "../../components/ui/tabs.tsx";
import { Button } from "../../components/ui/button.tsx";
import { BoxIcon, CheckSquareIcon, FileTextIcon, XIcon } from "lucide-react";
import { useEffect, useId, useRef, useState, type DragEvent } from "react";

type Tab = { id: string; title: string };
type Placement = { id: string; before: boolean };
const icons = { entities: BoxIcon, tasks: CheckSquareIcon, records: FileTextIcon };

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
    <span className="sr-only" id={help}>탭 제목을 드래그하거나 Ctrl+Shift+좌우 방향키로 순서를 바꿉니다.</span>
    <span className="sr-only" role="status">{notice}</span>
    <TabsList variant="line" className="h-auto min-w-0 flex-1 justify-start overflow-x-auto rounded-none p-0" aria-label="열린 상세" onKeyDown={event => {
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
    }}>{tabs.map(tab => <div className="relative flex max-w-64 shrink-0 items-center gap-1 data-[dragging=true]:opacity-50 data-[drop=before]:border-l-2 data-[drop=after]:border-r-2" key={tab.id} data-tab-id={tab.id} data-selected={active === tab.id || undefined}
      data-dragging={drag?.id === tab.id || undefined} data-drop={drag?.placement?.id === tab.id && drag.id !== tab.id ? drag.placement.before ? "before" : "after" : undefined}>
      <TabsTrigger value={tab.id} className="min-h-11 min-w-0 flex-none px-3" id={`tab-${tab.id}`} aria-selected={active === tab.id} aria-controls={`panel-${tab.id}`} aria-describedby={help}
        aria-keyshortcuts="Control+Shift+ArrowLeft Control+Shift+ArrowRight" tabIndex={active === tab.id ? 0 : -1} title={tab.title}
        draggable={enabled} onClick={() => select(tab.id)} onKeyDown={event => {
          if (["Enter", " "].includes(event.key)) { event.preventDefault(); if (enabled && !isBusy()) select(tab.id); }
        }} onDragStart={event => {
          if (!enabled || isBusy()) { event.preventDefault(); return; }
          source.current = tab.id; setDrag({ id: tab.id, placement: null });
          event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("application/x-workspace-tab", tab.id);
        }} onDragEnd={finish}>
        {(() => { const Icon = icons[tab.id.split("/")[1] as keyof typeof icons]; return Icon ? <Icon /> : null; })()}<span className="truncate">{tab.title}</span>
      </TabsTrigger><Button variant="ghost" size="icon" tabIndex={active === tab.id ? 0 : -1} aria-label={`${tab.title} 탭 닫기`} onClick={() => close(tab.id)}><XIcon /></Button>
    </div>)}</TabsList>
  </>;
}

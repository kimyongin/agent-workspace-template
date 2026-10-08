import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type HTMLAttributes } from "react";

const defaultRatio = 0.46;
const handleWidth = 12;

/** Own the split geometry and pointer lifecycle without changing retained detail visits. */
export function useWorkspaceResize(enabled: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const handle = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ pointer: number; x: number; width: number } | null>(null);
  const [ratio, setRatio] = useState(defaultRatio);
  const [geometry, setGeometry] = useState({ available: 0, min: 0, max: 0 });
  const [dragging, setDragging] = useState(false);
  const width = Math.min(geometry.max, Math.max(geometry.min, geometry.available * ratio));
  const stop = () => {
    const pointer = drag.current?.pointer;
    drag.current = null;
    if (pointer !== undefined && handle.current?.hasPointerCapture(pointer)) handle.current.releasePointerCapture(pointer);
    setDragging(false);
  };
  useLayoutEffect(() => {
    const container = ref.current;
    if (!enabled || !container) return;
    const measure = () => {
      const available = Math.max(0, container.clientWidth - handleWidth);
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
      const min = Math.min(27 * rem, available / 2);
      const listMin = Math.min(28 * rem, available / 2);
      setGeometry({ available, min, max: available - listMin });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, [enabled]);
  useEffect(() => {
    if (!enabled) stop();
    // Losing the surface (logout/navigation/mobile) must release an unfinished drag.
    return () => {
      const pointer = drag.current?.pointer;
      drag.current = null;
      if (pointer !== undefined && handle.current?.hasPointerCapture(pointer)) handle.current.releasePointerCapture(pointer);
    };
  }, [enabled]);
  const resize = (next: number) => {
    if (geometry.available) setRatio(Math.min(geometry.max, Math.max(geometry.min, next)) / geometry.available);
  };
  const percent = (value: number) => geometry.available ? Math.round(value / geometry.available * 100) : 46;
  const separator: HTMLAttributes<HTMLDivElement> & { ref: (element: HTMLDivElement | null) => void } = {
    ref: element => { handle.current = element; },
    role: "separator", "aria-label": "상세 패널 너비 조절", "aria-orientation": "vertical",
    "aria-controls": "workspace-details", "aria-valuemin": percent(geometry.min), "aria-valuemax": percent(geometry.max), "aria-valuenow": percent(width),
    "aria-valuetext": `상세 패널 ${percent(width)}%`, tabIndex: enabled ? 0 : -1, hidden: !enabled,
    title: "드래그하여 너비 조절 · 두 번 클릭하면 기본 너비",
    onPointerDown: event => {
      if (!enabled || !event.isPrimary || event.button !== 0 || drag.current) return;
      event.preventDefault(); event.currentTarget.focus({ preventScroll: true });
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { pointer: event.pointerId, x: event.clientX, width };
      setDragging(true);
    },
    onPointerMove: event => {
      const start = drag.current;
      if (start?.pointer === event.pointerId) resize(start.width + start.x - event.clientX);
    },
    onPointerUp: event => { if (drag.current?.pointer === event.pointerId) stop(); },
    onPointerCancel: event => { if (drag.current?.pointer === event.pointerId) stop(); },
    onLostPointerCapture: () => { drag.current = null; setDragging(false); },
    onDoubleClick: () => setRatio(defaultRatio),
    onKeyDown: event => {
      if (!enabled || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      resize(event.key === "Home" ? geometry.min : event.key === "End" ? geometry.max : width + (event.key === "ArrowLeft" ? 16 : -16));
    },
  };
  return { ref, separator, dragging, style: geometry.available ? { "--detail-width": `${width}px` } as CSSProperties : undefined };
}

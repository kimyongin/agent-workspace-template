import { useEffect, useRef, useState, type HTMLAttributes } from "react";
import "./resize-handle.css";

type ResizeOptions = {
  enabled: boolean; label: string; controls: string; direction: 1 | -1;
  size: { value: number; min: number; max: number };
  resize: (width: number) => void; reset: () => void;
};

/** Shared pointer ownership and keyboard operation for both desktop dividers. */
export function useResizeHandle({ enabled, label, controls, direction, size, resize, reset }: ResizeOptions) {
  const handle = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ pointer: number; x: number; width: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const stop = () => {
    const pointer = drag.current?.pointer;
    drag.current = null;
    if (pointer !== undefined && handle.current?.hasPointerCapture(pointer)) handle.current.releasePointerCapture(pointer);
    setDragging(false);
  };
  useEffect(() => {
    if (!enabled) stop();
    return () => {
      const pointer = drag.current?.pointer;
      drag.current = null;
      if (pointer !== undefined && handle.current?.hasPointerCapture(pointer)) handle.current.releasePointerCapture(pointer);
    };
  }, [enabled]);
  const change = (width: number) => resize(Math.min(size.max, Math.max(size.min, width)));
  const separator: HTMLAttributes<HTMLDivElement> & { ref: (element: HTMLDivElement | null) => void } = {
    ref: element => { handle.current = element; }, role: "separator", "aria-label": label, "aria-orientation": "vertical",
    "aria-controls": controls, "aria-valuemin": Math.round(size.min), "aria-valuemax": Math.round(size.max), "aria-valuenow": Math.round(size.value),
    "aria-valuetext": `${Math.round(size.value)}px`, tabIndex: enabled ? 0 : -1, hidden: !enabled,
    title: "드래그하여 너비 조절 · 두 번 클릭하면 기본 너비",
    onPointerDown: event => {
      if (!enabled || !event.isPrimary || event.button !== 0 || drag.current) return;
      event.preventDefault(); event.currentTarget.focus({ preventScroll: true });
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { pointer: event.pointerId, x: event.clientX, width: size.value };
      setDragging(true);
    },
    onPointerMove: event => {
      const start = drag.current;
      if (start?.pointer === event.pointerId) change(start.width + direction * (event.clientX - start.x));
    },
    onPointerUp: event => { if (drag.current?.pointer === event.pointerId) stop(); },
    onPointerCancel: event => { if (drag.current?.pointer === event.pointerId) stop(); },
    onLostPointerCapture: () => { drag.current = null; setDragging(false); }, onDoubleClick: reset,
    onKeyDown: event => {
      if (!enabled || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      change(event.key === "Home" ? size.min : event.key === "End" ? size.max : size.value + direction * (event.key === "ArrowRight" ? 16 : -16));
    },
  };
  return { separator, dragging };
}

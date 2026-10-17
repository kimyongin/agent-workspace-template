import { useDisplayScale } from "../features/settings/display-scale.tsx";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { PanelImperativeHandle } from "react-resizable-panels";

const desktopQuery = window.matchMedia("(min-width: 1024px) and (min-height: 320px)");
const subscribe = (notify: () => void) => { desktopQuery.addEventListener("change", notify); return () => desktopQuery.removeEventListener("change", notify); };

/** Account-local width is transient; the official Resizable panel owns pointer/keyboard resizing. */
export function useNavigationResize(account: string | null) {
  const scale = useDisplayScale();
  const desktop = useSyncExternalStore(subscribe, () => desktopQuery.matches, () => false);
  const panel = useRef<PanelImperativeHandle | null>(null);
  const [remProbe, setRemProbe] = useState<HTMLSpanElement | null>(null);
  const [rem, setRem] = useState(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
  const [group, setGroup] = useState<HTMLDivElement | null>(null);
  const [separator, setSeparator] = useState<HTMLDivElement | null>(null);
  const [available, setAvailable] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!group) return;
    // The separator's hit target is wider than its layout track. Measure CSS pixels,
    // matching the official panel library even when browser zoom changes visual pixels.
    const measure = () => {
      const next = group.clientWidth - (separator?.offsetWidth ?? 0);
      if (next > 0) setAvailable(next);
    };
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    });
    observer.observe(group);
    if (separator) observer.observe(separator);
    measure();
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [group, separator]);
  useLayoutEffect(() => {
    const probe = remProbe;
    if (!probe) return;
    // A rem-sized probe also observes browser/default-font changes without remounting panels.
    const measure = () => setRem(parseFloat(getComputedStyle(document.documentElement).fontSize));
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    });
    observer.observe(probe);
    measure();
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [remProbe]);
  const width = useRef(13);
  const resizing = useRef(false);
  useEffect(() => { resizing.current = false; width.current = 13; panel.current?.resize(desktop ? `${width.current * rem}px` : 0); }, [account]);
  useLayoutEffect(() => {
    resizing.current = false;
    // Restore only after the official panel has registered its new responsive constraints.
    const frame = requestAnimationFrame(() => panel.current?.resize(desktop ? `${width.current * rem}px` : 0));
    return () => cancelAnimationFrame(frame);
  }, [desktop, scale, rem]);
  // Keep the navigation readable at its nominal minimum; the application reflows
  // into the remaining width instead of supplying an impossible pair of minima.
  const applicationMinimum = Math.min(28 * rem, Math.max(0, (available ?? Infinity) - 13 * rem));
  return { desktop, panel, rem, remProbe: setRemProbe, group: setGroup, separator: setSeparator, applicationMinimum, beginResize: () => { resizing.current = true; }, remember: (pixels: number) => { if (resizing.current && desktop && pixels > 0) width.current = pixels / parseFloat(getComputedStyle(document.documentElement).fontSize); }, reset: () => { width.current = 13; panel.current?.resize(`${13 * rem}px`); } };
}

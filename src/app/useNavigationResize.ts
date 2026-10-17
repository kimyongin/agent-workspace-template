import { useDisplayScale } from "../features/settings/display-scale.tsx";
import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import type { PanelImperativeHandle } from "react-resizable-panels";

const desktopQuery = window.matchMedia("(min-width: 1024px) and (min-height: 320px)");
const subscribe = (notify: () => void) => { desktopQuery.addEventListener("change", notify); return () => desktopQuery.removeEventListener("change", notify); };

/** Account-local width is transient; the official Resizable panel owns pointer/keyboard resizing. */
export function useNavigationResize(account: string | null) {
  const scale = useDisplayScale();
  const desktop = useSyncExternalStore(subscribe, () => desktopQuery.matches, () => false);
  const panel = useRef<PanelImperativeHandle | null>(null);
  const width = useRef(13);
  const resizing = useRef(false);
  useEffect(() => { resizing.current = false; width.current = 13; panel.current?.resize(desktop ? `${width.current}rem` : 0); }, [account]);
  useLayoutEffect(() => {
    resizing.current = false;
    // Restore only after the official panel has registered its new responsive constraints.
    const frame = requestAnimationFrame(() => panel.current?.resize(desktop ? `${width.current}rem` : 0));
    return () => cancelAnimationFrame(frame);
  }, [desktop, scale]);
  return { desktop, panel, beginResize: () => { resizing.current = true; }, remember: (pixels: number) => { if (resizing.current && desktop && pixels > 0) width.current = pixels / parseFloat(getComputedStyle(document.documentElement).fontSize); }, reset: () => { width.current = 13; panel.current?.resize("13rem"); } };
}

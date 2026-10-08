import { useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { useResizeHandle } from "../components/useResizeHandle.ts";
import { useDisplayScale } from "../features/settings/display-scale.tsx";

const desktopQuery = window.matchMedia("(min-width: 1024px) and (min-height: 320px)");
const subscribe = (notify: () => void) => {
  desktopQuery.addEventListener("change", notify);
  return () => desktopQuery.removeEventListener("change", notify);
};

/** Account-local navigation width; reserve room for the list and desktop details. */
export function useNavigationResize(account: string | null) {
  const ref = useRef<HTMLElement>(null);
  const scale = useDisplayScale();
  const desktop = useSyncExternalStore(subscribe, () => desktopQuery.matches, () => false);
  const enabled = !!account && desktop;
  const [preferred, setPreferred] = useState({ account, rem: 13 });
  useLayoutEffect(() => { setPreferred({ account, rem: 13 }); }, [account]);
  const [geometry, setGeometry] = useState({ rem: 16, min: 160, max: 320 });
  const chosen = preferred.account === account ? preferred.rem : 13;
  const width = Math.min(geometry.max, Math.max(geometry.min, chosen * geometry.rem));
  useLayoutEffect(() => {
    if (!enabled || !ref.current) return;
    const measure = () => {
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
      const detail = innerWidth >= 1280 * scale / 100 && innerHeight >= 480 * scale / 100;
      const reserve = (detail ? 55 : 28) * rem + (detail ? 12 : 0);
      const min = 10 * rem, max = Math.max(min, Math.min(20 * rem, document.documentElement.clientWidth - reserve - 12));
      setGeometry({ rem, min, max });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(document.documentElement); observer.observe(ref.current);
    window.addEventListener("resize", measure);
    return () => { observer.disconnect(); window.removeEventListener("resize", measure); };
  }, [enabled, scale, account]);
  const resize = useCallback((value: number) => setPreferred({ account, rem: value / geometry.rem }), [account, geometry.rem]);
  const handle = useResizeHandle({ enabled, owner: account, label: "탐색 메뉴 너비 조절", controls: "workspace-navigation", direction: 1,
    size: { value: width, min: geometry.min, max: geometry.max }, resize, reset: () => setPreferred({ account, rem: 13 }) });
  return { ref, ...handle, style: { "--sidebar-width": `${width / geometry.rem}rem` } as CSSProperties };
}

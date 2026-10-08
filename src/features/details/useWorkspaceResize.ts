import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";

import { useResizeHandle } from "../../components/useResizeHandle.ts";

const defaultRatio = 0.46;
const handleWidth = 12;

/** Own the split geometry and pointer lifecycle without changing retained detail visits. */
export function useWorkspaceResize(enabled: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const [ratio, setRatio] = useState(defaultRatio);
  const [geometry, setGeometry] = useState({ available: 0, min: 0, max: 0 });
  const width = Math.min(geometry.max, Math.max(geometry.min, geometry.available * ratio));
  useLayoutEffect(() => {
    const container = ref.current;
    if (!enabled || !container) return;
    const measure = () => {
      const available = Math.max(0, container.clientWidth - handleWidth);
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
      const fits = available >= 55 * rem;
      const min = fits ? 27 * rem : available / 2;
      const listMin = fits ? 28 * rem : available / 2;
      setGeometry({ available, min, max: available - listMin });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, [enabled]);
  const handle = useResizeHandle({ enabled, label: "상세 패널 너비 조절", controls: "workspace-details", direction: -1,
    size: { value: width, min: geometry.min, max: geometry.max },
    resize: next => { if (geometry.available) setRatio(next / geometry.available); }, reset: () => setRatio(defaultRatio) });
  return { ref, ...handle, style: geometry.available ? { "--detail-width": `${width}px` } as CSSProperties : undefined };
}

import { createContext } from "react";

/** Readiness belongs to one list restoration context, never to accessibility roles or CSS. */
export function createPreviewReadiness(path: string | null) {
  let ready = !path, generation = 0;
  const listeners = new Set<() => void>();
  const update = (value: boolean) => {
    if (ready === value) return;
    ready = value;
    for (const listener of listeners) listener();
  };
  return {
    snapshot: () => ready,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    track: (selected: string) => {
      const token = selected === path ? ++generation : -1;
      if (token === generation) update(false);
      return {
        settle: (value: boolean) => { if (token === generation) update(value); },
        dispose: () => { if (token === generation) { generation++; update(false); } },
      };
    },
  };
}
export type PreviewReadiness = ReturnType<typeof createPreviewReadiness>;
export const ListPreviewReadiness = createContext<PreviewReadiness | null>(null);

import { createContext } from "react";

/** Readiness belongs to one list restoration context, never to accessibility roles or CSS. */
export function createPreviewReadiness(paths: readonly string[]) {
  const previews = new Map(paths.map(path => [path, { ready: false, generation: 0 }]));
  let ready = previews.size === 0;
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
      const preview = previews.get(selected);
      const token = preview ? ++preview.generation : -1;
      const settle = (value: boolean) => {
        if (!preview || token !== preview.generation) return;
        preview.ready = value;
        update([...previews.values()].every(item => item.ready));
      };
      settle(false);
      return {
        settle,
        dispose: () => { if (preview && token === preview.generation) { settle(false); preview.generation++; } },
      };
    },
  };
}
export type PreviewReadiness = ReturnType<typeof createPreviewReadiness>;
export const ListPreviewReadiness = createContext<PreviewReadiness | null>(null);

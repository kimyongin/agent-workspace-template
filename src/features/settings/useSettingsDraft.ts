import { useEffect, useMemo, useSyncExternalStore } from "react";
import { createSettingsDraft, type SettingsDraftAdapter } from "./settings-draft.ts";
export function useSettingsDraft<T, Saved>(
  adapter: SettingsDraftAdapter<T, Saved>,
  onStateChange?: (state: { dirty: boolean; busy: boolean }) => void,
) {
  const resource = useMemo(() => createSettingsDraft(adapter), [adapter]);
  const state = useSyncExternalStore(resource.subscribe, resource.snapshot);
  useEffect(() => {
    void resource.read();
    return resource.cancel;
  }, [resource]);
  useEffect(() => {
    onStateChange?.({ dirty: state.dirty, busy: state.busy });
  }, [state.dirty, state.busy, onStateChange]);
  return { ...state, resource };
}

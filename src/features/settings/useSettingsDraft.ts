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
    return resource.dispose;
  }, [resource]);
  useEffect(() => {
    // Route guards protect drafts and in-flight writes; a clean GET can be canceled on navigation.
    onStateChange?.({ dirty: state.dirty, busy: state.busy && state.operation === "save" });
  }, [state.dirty, state.busy, state.operation, onStateChange]);
  return { ...state, resource };
}

export interface SettingsDraftAdapter<T, Saved> {
  initial: T;
  read: (signal: AbortSignal) => Promise<Saved>;
  save: (draft: T, before: Saved, signal: AbortSignal) => Promise<Saved>;
  toDraft: (saved: Saved) => T;
  refreshDraft: (before: T, local: T, latest: T) => T;
  isConflict: (error: unknown) => boolean;
}

/** One setting owns its baseline and draft; its adapter owns the refresh preservation policy. */
export function createSettingsDraft<T, Saved>(adapter: SettingsDraftAdapter<T, Saved>) {
  let state = {
    saved: null as Saved | null,
    draft: adapter.initial,
    dirty: false,
    busy: false,
    operation: null as "read" | "save" | null,
    error: null as unknown,
    conflict: false,
  };
  let request: AbortController | null = null;
  const listeners = new Set<() => void>();
  const emit = (patch: Partial<typeof state>) => {
    state = { ...state, ...patch };
    state.dirty = state.saved !== null && JSON.stringify(state.draft) !== JSON.stringify(adapter.toDraft(state.saved));
    for (const listener of listeners) listener();
  };
  const cancel = () => {
    request?.abort();
    request = null;
  };
  const run = async (operation: "read" | "save"): Promise<Saved | null> => {
    if (
      state.operation === "save" && state.busy || operation === "save" && (state.busy || !state.saved || !state.dirty)
    ) return null;
    cancel();
    const current = new AbortController();
    request = current;
    emit({ busy: true, operation, error: null });
    try {
      const saved = operation === "read"
        ? await adapter.read(current.signal)
        : await adapter.save(state.draft, state.saved!, current.signal);
      if (current.signal.aborted || request !== current) return null;
      const latest = adapter.toDraft(saved);
      const draft = operation === "read" && state.saved
        ? adapter.refreshDraft(adapter.toDraft(state.saved), state.draft, latest)
        : latest;
      emit({ saved, draft, conflict: false });
      return saved;
    } catch (error) {
      if (!current.signal.aborted && request === current) {
        emit({ error, conflict: operation === "read" ? state.conflict : adapter.isConflict(error) });
      }
      return null;
    } finally {
      if (!current.signal.aborted && request === current) {
        request = null;
        emit({ busy: false });
      }
    }
  };
  return {
    snapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    read: () => run("read"),
    save: () => run("save"),
    cancel,
    edit: (update: (value: T) => T) => {
      if (!state.busy) emit({ draft: update(state.draft), error: null });
    },
    reset: () => {
      if (!state.busy && state.saved) emit({ draft: adapter.toDraft(state.saved), error: null, conflict: false });
    },
  };
}

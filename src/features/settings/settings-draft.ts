import { WriteAttempt } from "../../lib/write-attempt.ts";
export interface SettingsDraftAdapter<T, Saved> {
  initial: T;
  read: (signal: AbortSignal) => Promise<Saved>;
  save: (draft: T, before: Saved, signal: AbortSignal, requestKey: string) => Promise<Saved>;
  toDraft: (saved: Saved) => T;
  isConflict: (error: unknown) => boolean;
  /** Versioned settings detect concurrent changes even during a background read. */
  version?: (saved: Saved) => number;
}

/** One setting owns its baseline and draft; conflicts require explicitly adopting the latest baseline. */
export function createSettingsDraft<T, Saved>(adapter: SettingsDraftAdapter<T, Saved>) {
  let state = {
    saved: null as Saved | null,
    draft: adapter.initial,
    dirty: false,
    busy: false,
    operation: null as "read" | "save" | null,
    error: null as unknown,
    conflict: false,
    latestReady: false,
    uncertain: false,
  };
  const attempt=new WriteAttempt<Saved>();
  let request: AbortController | null = null;
  const listeners = new Set<() => void>();
  const emit = (patch: Partial<typeof state>) => {
    state = { ...state, ...patch };
    state.dirty = state.saved !== null && JSON.stringify(state.draft) !== JSON.stringify(adapter.toDraft(state.saved));
    for (const listener of listeners) listener();
  };
  const cancel = () => {
    if(state.operation === "save" && state.busy) return;
    request?.abort();
    request = null;
  };
  const run = async (operation: "read" | "save"): Promise<Saved | null> => {
    if (
      state.operation === "save" && state.busy || operation === "save" && (state.busy || state.conflict || !state.saved || !state.dirty)
    ) return null;
    if(operation === "read" && attempt.snapshot().uncertain) return null;
    const frozenDraft=structuredClone(state.draft), frozenSaved=state.saved;
    cancel();
    const current = new AbortController();
    request = current;
    emit({ busy: true, operation, error: null, latestReady: false });
    try {
      let saved:Saved | undefined;
      if(operation === "read") saved=await adapter.read(current.signal);
      else {
        saved=await attempt.run(()=>adapter.save(frozenDraft,frozenSaved!,current.signal,attempt.requestKey()));
      }
      if (saved === undefined || current.signal.aborted || request !== current) return null;
      const latest = adapter.toDraft(saved);
      const draft = operation === "read" && (state.conflict || state.dirty) ? state.draft : latest;
      const concurrent = operation === "read" && state.dirty && state.saved !== null && adapter.version !== undefined &&
        adapter.version(state.saved) !== adapter.version(saved);
      const conflict = operation === "read" && (state.conflict || concurrent);
      emit({ saved, draft, conflict, latestReady: operation === "read" && conflict });
      return saved;
    } catch (error) {
      if (!current.signal.aborted && request === current) {
        emit({ error, conflict: operation === "read" ? state.conflict : adapter.isConflict(error) });
      }
      return null;
    } finally {
      if (!current.signal.aborted && request === current) {
        request = null;
        emit({ busy: false, uncertain:attempt.snapshot().uncertain });
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
    dispose:()=>{cancel();attempt.abandon();},
    edit: (update: (value: T) => T) => {
      if (!state.busy && !state.uncertain) emit({ draft: update(state.draft), error: null });
    },
    acceptLatest: () => {
      if (!state.busy && !state.uncertain && state.saved && state.conflict && state.latestReady) {
        emit({ conflict: false, latestReady: false, error: null });
      }
    },
    reset: () => {
      if (!state.busy && !state.uncertain && state.saved && (!state.conflict || state.latestReady)) {
        emit({ draft: adapter.toDraft(state.saved), error: null, conflict: false, latestReady: false });
      }
    },
  };
}

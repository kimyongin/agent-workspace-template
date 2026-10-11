export type DetailSnapshot<T> = {
  value: T | null;
  error: unknown | null;
  loading: boolean;
  editReady: boolean;
  confirmed: boolean;
};

/** Owns reads and confirmed values, without owning forms, mutations or navigation. */
export function createDetailResource<T>(options: {
  load: (signal: AbortSignal) => Promise<T>;
  isConflict: (error: unknown) => boolean;
  readyAfterFailedRefresh?: boolean;
}) {
  let state: DetailSnapshot<T> = { value: null, error: null, loading: false, editReady: false, confirmed: false };
  let request: AbortController | null = null;
  let generation = 0;
  let conflicted = false;
  const listeners = new Set<() => void>();
  const emit = (patch: Partial<DetailSnapshot<T>>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };
  const cancel = () => { generation++; request?.abort(); request = null; };
  const reload = async (prepareEdit = false) => {
    cancel();
    const started = generation;
    const controller = new AbortController();
    request = controller;
    emit({ loading: true, error: null, ...(prepareEdit ? { editReady: false } : {}) });
    try {
      const loaded = await options.load(controller.signal);
      if (started !== generation || controller.signal.aborted) return;
      emit({ value: loaded, error: null, editReady: true, confirmed: false });
    } catch (error) {
      if (started !== generation || controller.signal.aborted) return;
      emit({ error, ...(options.readyAfterFailedRefresh && state.value ? { editReady: true } : {}) });
    } finally {
      if (started === generation) { request = null; emit({ loading: false }); }
    }
  };
  const confirm = (update: T | ((current: T | null) => T | null)) => {
    cancel();
    const value = typeof update === "function" ? (update as (current: T | null) => T | null)(state.value) : update;
    emit({ value, error: null, loading: false, editReady: true, confirmed: true });
  };
  const failed = (error: unknown) => { if (options.isConflict(error)) conflicted = true; };
  return {
    snapshot: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    reload,
    confirm,
    failed,
    save: async (operation: (current: T) => Promise<T>) => {
      if (!state.value) throw new Error("Detail has not loaded");
      const current = state.value;
      cancel();
      emit({ loading: false });
      try { confirm(await operation(current)); conflicted = false; }
      catch (error) { failed(error); throw error; }
    },
    editClosed: () => { if (conflicted) { conflicted = false; void reload(); } },
    cancel,
  };
}

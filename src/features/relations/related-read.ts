export type RelatedReadStage = "probe" | "preview";
export type RelatedReadValue<T> = { value: T | null; error: unknown | null; loading: boolean };

/** One row owns its eager probe and expansion revalidation, never a global cache. */
export function createRelatedRead<T>(options: { load: (signal: AbortSignal) => Promise<T> }) {
  const empty = (): RelatedReadValue<T> => ({ value: null, error: null, loading: false });
  let state = { probe: empty(), preview: empty() };
  const requests: Record<RelatedReadStage, AbortController | null> = { probe: null, preview: null };
  const listeners = new Set<() => void>();
  const publish = (stage: RelatedReadStage, value: RelatedReadValue<T>) => {
    state = { ...state, [stage]: value };
    for (const listener of listeners) listener();
  };
  const cancelStage = (stage: RelatedReadStage) => {
    requests[stage]?.abort();
    requests[stage] = null;
  };
  return {
    snapshot: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    read: async (stage: RelatedReadStage) => {
      cancelStage(stage);
      const request = new AbortController();
      requests[stage] = request;
      publish(stage, { value: stage === "probe" ? state.probe.value : null, error: null, loading: true });
      try {
        const value = await options.load(request.signal);
        if (!request.signal.aborted) publish(stage, { value, error: null, loading: false });
      } catch (error) {
        if (!request.signal.aborted) publish(stage, { ...state[stage], error, loading: false });
      } finally {
        if (requests[stage] === request) requests[stage] = null;
      }
    },
    closePreview: () => { cancelStage("preview"); publish("preview", empty()); },
    cancel: () => { cancelStage("probe"); cancelStage("preview"); },
  };
}
export type RelatedRead<T> = ReturnType<typeof createRelatedRead<T>>;

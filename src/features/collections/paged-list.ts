export type ListPage<T> = { items: T[]; next_cursor: string | null; anchor_page?: number | null };
export const MAX_RESTORE_PAGES = 250;
export type LoadedPage<P> = P & { pages: number };
export type Completion = { pages: number; anchorFound: boolean; source: "restore" | "more" };
export type ListSnapshot<P> = {
  page: LoadedPage<P> | null;
  busy: boolean;
  error: unknown | null;
  completion: Completion | null;
  showMoreControl: boolean;
};

/** Owns accepted pages and every request's lifetime; transports and navigation stay with callers. */
export function createPagedList<T extends { id: string }, P extends ListPage<T>>(options: {
  load: (cursor: string | undefined, signal: AbortSignal) => Promise<P>;
  anchorLookahead?: number;
  maxRestorePages?: number;
  itemKey?: (item: T) => string;
  restoreRetry?: "restart" | "resume";
  retainOnDecrease?: boolean;
}) {
  const maxRestorePages = options.maxRestorePages ?? MAX_RESTORE_PAGES;
  const itemKey = options.itemKey ?? ((item: T) => item.id);
  let state: ListSnapshot<P> = { page: null, busy: false, error: null, completion: null, showMoreControl: false };
  const listeners = new Set<() => void>();
  let acceptedCursors = new Set<string>();
  let controller: AbortController | null = null;
  let intent = { pages: 1, anchor: undefined as string | undefined };
  let active: { pages: number; anchor?: string } | null = null;
  let reservedAppend: { pages: number; anchor?: string } | null = null;
  let failed: "restore" | "more" | "refresh" | null = null;
  const emit = (patch: Partial<ListSnapshot<P>>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };
  const cancel = () => { controller?.abort(); controller = null; active = null; };
  const run = async (target: number, anchor: string | undefined, source: "restore" | "more", restart = false, atomic = false) => {
    cancel();
    const request = new AbortController();
    controller = request;
    active = { pages: target, anchor };
    const current = () => controller === request && !request.signal.aborted;
    // Capture the adapter once: an in-flight replay cannot change query between pages.
    const load = options.load;
    let result = restart ? null : state.page;
    const hadPrior = !!result;
    let targetPages = source === "more" ? target : Math.min(maxRestorePages, target);
    let budget = source === "more" ? target : Math.min(maxRestorePages, targetPages + (anchor ? options.anchorLookahead ?? 5 : 0));
    const visited = new Set(restart ? [] : acceptedCursors);
    let validCursors = new Set(visited);
    const publish = () => {
      if (current() && result && state.page !== result) {
        acceptedCursors = new Set(validCursors);
        emit({ page: result, showMoreControl: state.showMoreControl || !!result.next_cursor });
      }
    };
    if (restart && !atomic) acceptedCursors.clear();
    // Retain an append error until its replacement rows arrive, so retry does not shrink the page beneath the focused control.
    emit({ busy: true, error: source === "more" ? state.error : null, completion: null, ...(restart && !atomic ? { page: null } : {}) });
    try {
      while ((!result || result.pages < targetPages || !!anchor && !result.items.some(item => itemKey(item) === anchor)) &&
        (!result || result.next_cursor) && (result?.pages ?? 0) < budget) {
        const cursor = result?.next_cursor ?? undefined;
        if (cursor && visited.has(cursor)) throw new Error("Repeated list cursor");
        if (cursor) visited.add(cursor);
        const page = await load(cursor, request.signal);
        if (!current()) return;
        if (page.next_cursor && visited.has(page.next_cursor)) throw new Error("Repeated list cursor");
        if (!result && anchor && page.anchor_page && Number.isSafeInteger(page.anchor_page)) {
          targetPages = Math.min(maxRestorePages, Math.max(targetPages, page.anchor_page));
          budget = Math.min(maxRestorePages, Math.max(budget, targetPages));
        }
        const ids = new Set(result?.items.map(itemKey));
        result = { ...page, items: [...result?.items ?? [], ...page.items.filter(item => {
          if (ids.has(itemKey(item))) return false;
          ids.add(itemKey(item)); return true;
        })], pages: (result?.pages ?? 0) + 1 } as LoadedPage<P>;
        validCursors = new Set(visited);
        if (!atomic && (targetPages <= 20 || result.pages === 1 || result.pages % 20 === 0 || result.pages >= targetPages)) publish();
      }
      publish();
      if (current()) {
        failed = null;
        emit({ error: null, completion: result ? { pages: result.pages, anchorFound: !anchor || result.items.some(item => itemKey(item) === anchor), source } : null,
          ...(!hadPrior && source === "restore" && !result?.next_cursor ? { showMoreControl: false } : {}) });
      }
    } catch (error) {
      if (current()) { if(!atomic)publish(); failed = atomic ? "refresh" : source; emit({ error, showMoreControl: true }); }
    } finally {
      if (current()) { active = null; controller = null; emit({ busy: false }); }
    }
  };
  return {
    snapshot: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    restore: (pages: number, anchor?: string) => {
      pages = Math.min(maxRestorePages, Math.max(1, pages));
      intent = { pages, anchor };
      // An append's URL can commit after a fast success or failure response.
      const acknowledged = reservedAppend?.pages === pages && reservedAppend.anchor === anchor;
      reservedAppend = null;
      if (acknowledged) return Promise.resolve();
      // URL acknowledgement of a reserved append must not cancel and repeat its request.
      if (active?.pages === pages && active.anchor === anchor) return Promise.resolve();
      if (!state.busy && state.completion && state.page && state.page.pages >= pages &&
        (!anchor || state.page.items.some(item => itemKey(item) === anchor)) &&
        (options.retainOnDecrease || state.page.pages === pages)) return Promise.resolve();
      const restart = !options.retainOnDecrease && !!state.page && Math.min(state.page.pages, maxRestorePages) > pages;
      return run(pages, anchor, "restore", restart);
    },
    more: () => {
      if (state.busy || !state.page?.next_cursor) return undefined;
      const target = state.page.pages + 1;
      void run(target, intent.anchor, "more");
      reservedAppend = {pages:target,anchor:intent.anchor};
      return target;
    },
    retry: () => {
      if (state.busy) return Promise.resolve();
      if (failed === "refresh") return run(intent.pages, intent.anchor, "restore", true, true);
      return failed === "more" && state.page?.next_cursor
        ? run(state.page.pages + 1, intent.anchor, "more")
        : run(intent.pages, intent.anchor, "restore", options.restoreRetry === "restart");
    },
    refresh: (options?: { clear?: boolean }) => run(intent.pages, intent.anchor, "restore", true, !options?.clear),
    cancel,
  };
}

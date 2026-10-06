import { activityLocation } from "./activity-location.ts";
export type ActivityListKind = "tasks" | "records" | "principles" | "entities";
export type ListPage<T> = { items: T[]; next_cursor: string | null; anchor_page?: number | null };
export type LoadedList<T> = ListPage<T> & { pages: number };
export const MAX_RESTORE_PAGES = 250;
const ANCHOR_LOOKAHEAD_PAGES = 5;
const RESTORE_PUBLISH_PAGES = 20;

/** Long replays keep progress visible without rendering every growing prefix. */
export function shouldPublishRestoredPage(count: number, target: number): boolean {
  return target <= RESTORE_PUBLISH_PAGES || count === 1 || count % RESTORE_PUBLISH_PAGES === 0 || count >= target;
}

export function requestedPages(params: URLSearchParams): number {
  const value = Number(params.get("pages") ?? 1);
  return Number.isSafeInteger(value) && value > 0 ? Math.min(value, MAX_RESTORE_PAGES) : 1;
}

export function listScope(params: URLSearchParams): string {
  const scope = new URLSearchParams(params);
  scope.delete("pages");
  scope.delete("scroll");
  scope.delete("collapsed");
  scope.delete("create");
  scope.sort();
  return scope.toString();
}

export function listAnchor(kind: ActivityListKind, id: string): string {
  return kind === "principles" ? `principle-${id}` : kind === "entities" ? `entity-${id}` : `activity-${kind}-${id}`;
}

export function anchorId(kind: ActivityListKind, hash: string): string | undefined {
  const prefix = kind === "principles" ? "principle" : kind === "entities" ? "entity" : `activity-${kind}`;
  const match = new RegExp(`^#${prefix}-([0-9a-f-]{36})$`).exec(hash);
  return match?.[1];
}

export function listReturnPath(kind: ActivityListKind, params: URLSearchParams, id: string, scroll: number, route = `/${kind}`): string {
  const next = new URLSearchParams(params);
  next.set("scroll", String(Math.max(0, Math.round(scroll))));
  return `${route}?${next}#${listAnchor(kind, id)}`;
}

/** Only a matching internal list can override the normal detail fallback. */
export function safeListReturn(value: string | null, kind: ActivityListKind, fallback: string): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return fallback;
  try {
    const url = new URL(value, "https://activity.invalid");
    if (url.origin !== "https://activity.invalid") return fallback;
    if (url.pathname !== `/${kind}`) {
      if ((kind !== "tasks" && kind !== "records") || !["/tasks", "/records"].includes(url.pathname)
        || !anchorId(kind, url.hash) && !url.searchParams.has(`${kind}_pages`)) return fallback;
      const legacy = activityLocation(kind, url.searchParams, url.hash);
      return `${legacy.route}?${legacy.params}${legacy.hash}`;
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}

export function appendItems<T extends { id: string }>(prior: T[], next: T[]): T[] {
  const ids = new Set(prior.map((item) => item.id));
  return [
    ...prior,
    ...next.filter((item) => {
      if (ids.has(item.id)) return false;
      ids.add(item.id);
      return true;
    }),
  ];
}

/** Fresh first-page reads on remount. The caller cancels/ignores a superseded scope. */
export async function restoreList<T extends { id: string }>(options: {
  load: (cursor?: string) => Promise<ListPage<T>>;
  pages: number;
  anchor?: string;
  prior?: LoadedList<T>;
  current: () => boolean;
  publish: (value: LoadedList<T>) => void;
}): Promise<LoadedList<T> | undefined> {
  let result = options.prior;
  const visited = new Set<string>();
  let targetPages=options.pages;
  let budget = Math.min(MAX_RESTORE_PAGES, options.pages + (options.anchor ? ANCHOR_LOOKAHEAD_PAGES : 0));
  let published: LoadedList<T> | undefined;
  const publish = () => {
    if (result && result !== published && options.current()) {
      published = result;
      options.publish(result);
    }
  };
  try {
    while (
      (!result || result.pages < targetPages ||
        !!options.anchor && !result.items.some((item) => item.id === options.anchor)) &&
      (!result || result.next_cursor) && (result?.pages ?? 0) < budget
    ) {
      const cursor = result?.next_cursor ?? undefined;
      if (cursor && visited.has(cursor)) throw new Error("Repeated list cursor");
      if (cursor) visited.add(cursor);
      const page = await options.load(cursor);
      if (!options.current()) return undefined;
      if (page.next_cursor && visited.has(page.next_cursor)) throw new Error("Repeated list cursor");
      if(!result && options.anchor && page.anchor_page && Number.isSafeInteger(page.anchor_page)) {
        targetPages=Math.min(MAX_RESTORE_PAGES,Math.max(targetPages,page.anchor_page));
        budget=Math.min(MAX_RESTORE_PAGES,Math.max(budget,targetPages));
      }
      result = { ...page, items: appendItems(result?.items ?? [], page.items), pages: (result?.pages ?? 0) + 1 };
      if (shouldPublishRestoredPage(result.pages, targetPages)) publish();
    }
    publish();
    return result;
  } catch (error) {
    // A failure must reveal every valid page, including the unfinished render batch.
    publish();
    throw error;
  }
}

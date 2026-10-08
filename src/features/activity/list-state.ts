import { entityReferenceId } from "@contracts/entity-identity.ts";
import { activityLocation } from "./activity-location.ts";
export type ActivityListKind = "tasks" | "records" | "principles" | "entities";
import { MAX_RESTORE_PAGES } from "../collections/paged-list.ts";

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
  scope.delete("open");
  scope.delete("filters");
  ["view", "calendar_month", "calendar_day"].forEach(key => scope.delete(key));
  scope.sort();
  return scope.toString();
}

export function listAnchor(kind: ActivityListKind, id: string): string {
  return kind === "principles" ? `principle-${id}` : kind === "entities" ? `entity-${id}` : `activity-${kind}-${id}`;
}

export function anchorId(kind: ActivityListKind, hash: string): string | undefined {
  const prefix = kind === "principles" ? "principle" : kind === "entities" ? "entity" : `activity-${kind}`;
  if (!hash.startsWith(`#${prefix}-`)) return undefined;
  try {
    const id = decodeURIComponent(hash.slice(prefix.length + 2));
    return kind === "entities"
      ? entityReferenceId.safeParse(id).success ? id : undefined
      : /^[0-9a-f-]{36}$/.test(id) ? id : undefined;
  } catch { return undefined; }
}

export function listReturnPath(kind: ActivityListKind, params: URLSearchParams, id: string, scroll: number, route = `/${kind}`): string {
  const next = new URLSearchParams(params);
  next.set("scroll", String(Math.max(0, Math.round(scroll))));
  return `${route}?${next}#${encodeURIComponent(listAnchor(kind, id))}`;
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

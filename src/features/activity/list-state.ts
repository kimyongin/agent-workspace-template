import { detailListLink, entityListReturnPath, entityListAnchor, internalListReturn } from "../../lib/entity-list-url.ts";
import { dataId } from "@contracts/data-id.ts";
import { entityReferenceId } from "@contracts/entity-identity.ts";
import { activityLocation } from "./activity-location.ts";
export type ActivityListKind = "tasks" | "records" | "entities";
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
  return kind === "entities" ? `entity-${id}` : `activity-${kind}-${id}`;
}

export function anchorId(kind: ActivityListKind, hash: string): string | undefined {
  if (kind === "entities") hash = entityListAnchor(hash);
  const prefix = kind === "entities" ? "entity" : `activity-${kind}`;
  if (!hash.startsWith(`#${prefix}-`)) return undefined;
  try {
    const id = decodeURIComponent(hash.slice(prefix.length + 2));
    return kind === "entities"
      ? entityReferenceId.safeParse(id).success ? id : undefined
      : dataId.safeParse(id).success ? id : undefined;
  } catch { return undefined; }
}

function listReturnPath(kind: ActivityListKind, params: URLSearchParams, id: string, scroll: number, route: string, hash: string): string {
  if (kind === "entities") return entityListReturnPath(params, hash, id, scroll, route);
  const next = new URLSearchParams(params);
  next.set("scroll", String(Math.max(0, Math.round(scroll))));
  return `${route}?${next}#${encodeURIComponent(listAnchor(kind, id))}`;
}

/** A row visit provides both destinations for desktop tabs and ordinary browser history. */
export function listDetailVisit(kind: ActivityListKind, location: { pathname: string; search: string; hash: string }, id: string, scroll: number) {
  const back = listReturnPath(kind, new URLSearchParams(location.search), id, scroll, location.pathname, location.hash);
  const url = new URL(back, "https://workspace.invalid");
  return {
    to: detailListLink(`/${kind}/${encodeURIComponent(id)}`, back),
    back,
    origin: { pathname: url.pathname, search: url.search, hash: url.hash },
  };
}

/** Only a matching internal list can override the normal detail fallback. */
export function safeListReturn(value: string | null, kind: ActivityListKind, fallback: string): string {
  if (kind === "entities") return internalListReturn(value, "/entities") ?? fallback;
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

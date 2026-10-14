import { entityListQuery } from "@contracts/entity.ts";
import { ENTITY_QUERY_URL_MAX_BYTES } from "@contracts/entity-query.ts";
import { entityPath } from "@contracts/entity-identity.ts";
const key = "property_filters";
const invalid = "속성 조건 주소가 잘못되었거나 중복되었습니다. 조건을 확인하거나 초기화하세요.";
type VisitLocation = { pathname: string; search: string; hash?: string };

/** Resolve a visit's disclosed list without accepting another owner's route or an external URL. */
export function detailListReturn(location: VisitLocation, owner = `/${location.pathname.split("/")[1]}`): string | null {
  return internalListReturn(new URLSearchParams(location.search).get("list"), owner, location.hash ?? "");
}

export function internalListReturn(value: string | null, owner: string, hash = ""): string | null {
  if (!value?.startsWith("/") || value.startsWith("//") || value.includes("\\")) return null;
  try {
    const url = new URL(restoreEntityListLink(value, hash), "https://workspace.invalid");
    return url.origin === "https://workspace.invalid" && url.pathname === owner ? `${url.pathname}${url.search}${url.hash}` : null;
  } catch { return null; }
}

/** A list row's return context owns scroll, focus and the short/fragment representation. */
export function entityListReturnPath(params: URLSearchParams, hash: string, id: string, scroll: number, route = "/entities"): string {
  const next = new URLSearchParams(params);
  next.set("scroll", String(Math.max(0, Math.round(scroll))));
  const anchor = `#${encodeURIComponent(`entity-${id}`)}`;
  const state = readEntityListUrl(params, hash);
  if (state.error) return `${route}?${next}${new URLSearchParams(hash.slice(1)).has(key) ? hash : anchor}`;
  const url = writeEntityListUrl(next, state.raw, anchor);
  return `${route}?${url.search}${url.hash}`;
}
export function readEntityListUrl(params: URLSearchParams, hash: string) {
  const fragment = new URLSearchParams(hash.slice(1));
  const hasFragment = fragment.has(key);
  const raw = hasFragment ? fragment.get(key) : params.get(key);
  let error: string | null = null;
  const anchor = hasFragment ? fragment.get("anchor") ? `#${encodeURIComponent(fragment.get("anchor")!)}` : "" : hash;
  if (params.getAll(key).length > 1 || params.getAll("entity_type_id").length > 1 || hasFragment && (
    params.has(key) || fragment.getAll(key).length !== 1 || fragment.getAll("entity_type_id").length !== 1 || fragment.getAll("anchor").length > 1 ||
    [...fragment.keys()].some(name => ![key,"entity_type_id","anchor"].includes(name)) || !params.get("entity_type_id") || fragment.get("entity_type_id") !== params.get("entity_type_id")
  )) error = invalid;
  if (hasFragment) { try { decodeURIComponent(hash.slice(1)); } catch { error = invalid; } }
  if (raw !== null) {
    try { if (!entityListQuery.shape.filters.safeParse(JSON.parse(raw)).success) error = invalid; } catch { error = invalid; }
  }
  return { raw, anchor, error };
}
export function writeEntityListUrl(params: URLSearchParams, raw: string | null, anchor = "") {
  const next = new URLSearchParams(params); next.delete(key);
  if (raw) next.set(key, raw);
  if (!raw || new TextEncoder().encode(`/entities?${next}`).byteLength <= ENTITY_QUERY_URL_MAX_BYTES) return { search: next.toString(), hash: anchor };
  next.delete(key);
  const fragment = new URLSearchParams({ [key]: raw, entity_type_id: next.get("entity_type_id") ?? "" });
  if (anchor) { try { fragment.set("anchor", decodeURIComponent(anchor.slice(1))); } catch { fragment.set("anchor", anchor.slice(1)); } }
  return { search: next.toString(), hash: `#${fragment}` };
}
/** Keep list filter fragments out of a detail's encoded list query as well. */
export function detailListLink(path: string, list: string) {
  if (!list.startsWith("/entities?") && !path.split(/[?#]/)[0].startsWith("/entities/")) return `${path}?list=${encodeURIComponent(list)}`;
  const url = new URL(list, "https://workspace.invalid"), detail = new URL(path,"https://workspace.invalid");
  const fragmented = new URLSearchParams(url.hash.slice(1)).has(key);
  detail.searchParams.set("list", fragmented ? `${url.pathname}${url.search}` : list);
  if (fragmented) detail.hash = url.hash;
  return `${detail.pathname}${detail.search}${detail.hash}`;
}
/** Common condition changes preserve malformed URLs until explicit repair/reset. */
export function changeEntityListQuery(next: URLSearchParams, current: URLSearchParams, hash: string) {
  const state = readEntityListUrl(current, hash);
  return state.error ? { search: next.toString(), hash } : writeEntityListUrl(next, state.raw);
}
function restoreEntityListLink(list: string, hash: string) {
  if (!list.startsWith("/entities?") || !new URLSearchParams(hash.slice(1)).has(key)) return list;
  const url = new URL(list, "https://workspace.invalid");
  if (url.hash) return `${list}&${hash.slice(1)}`;
  return `${list}${hash}`;
}

/** Existing list focus callers can read the anchor without decoding filters themselves. */
export function entityListAnchor(hash: string) {
  const fragment = new URLSearchParams(hash.slice(1));
  if (!fragment.has(key)) return hash;
  const state = readEntityListUrl(new URLSearchParams({ entity_type_id: fragment.get("entity_type_id") ?? "" }),hash);
  return state.error ? "" : state.anchor;
}

/** Same-detail modes retain the validated list-fragment representation and its origin anchor. */
export function detailModeLink(pathname: string, params: URLSearchParams, hash: string) {
  const path = `${pathname}?${params}${hash}`;
  const list = params.get("list");
  return list?.startsWith("/entities?") ? detailListLink(path, restoreEntityListLink(list, hash)) : path;
}

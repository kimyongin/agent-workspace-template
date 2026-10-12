import { readEntityListUrl, writeEntityListUrl, entityDetailListLink, restoreEntityListLink } from "../../lib/entity-list-url.ts";
import { entityPath } from "@contracts/entity-identity.ts";
import type { NavigateOptions } from "react-router";

/** A replacement visit owns its list disclosure, anchor and retained-tab transfer metadata. */
export function replaceEntityDetailVisit(
  location: { pathname: string; search: string; hash?: string },
  previousId: string,
  savedId: string,
): { path: string; options: NavigateOptions } {
  const viewer = new URLSearchParams(location.search);
  viewer.delete("edit");
  viewer.delete("edit_from");
  const list = viewer.get("list");
  if (list?.startsWith("/entities?")) {
    const destination = new URL(restoreEntityListLink(list, location.hash ?? ""), "https://workspace.invalid");
    const opened = destination.searchParams.getAll("open");
    destination.searchParams.delete("open");
    for (const path of opened) {
      destination.searchParams.append("open", path === entityPath(previousId) ? entityPath(savedId) : path);
    }
    const state = readEntityListUrl(destination.searchParams,destination.hash);
    const anchor = state.anchor === `#${encodeURIComponent(`entity-${previousId}`)}` ? `#${encodeURIComponent(`entity-${savedId}`)}` : state.anchor;
    const target = writeEntityListUrl(destination.searchParams,state.raw,anchor);
    viewer.set("list", `${destination.pathname}?${target.search}${target.hash}`);
  }
  return {
    path: viewer.has("list") ? (() => {
      const back = viewer.get("list")!;viewer.delete("list");
      return entityDetailListLink(`${entityPath(savedId)}?${viewer}`,back);
    })() : `${entityPath(savedId)}?${viewer}${location.hash ?? ""}`,
    options: { replace: true, state: { rekeyedDetail: location.pathname } },
  };
}

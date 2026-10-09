import { entityPath } from "@contracts/entity-identity.ts";
import type { NavigateOptions } from "react-router";

/** A replacement visit owns its list disclosure, anchor and retained-tab transfer metadata. */
export function replaceEntityDetailVisit(
  location: { pathname: string; search: string },
  previousId: string,
  savedId: string,
): { path: string; options: NavigateOptions } {
  const viewer = new URLSearchParams(location.search);
  viewer.delete("edit");
  viewer.delete("edit_from");
  const list = viewer.get("list");
  if (list?.startsWith("/entities?")) {
    const destination = new URL(list, "https://workspace.invalid");
    const opened = destination.searchParams.getAll("open");
    destination.searchParams.delete("open");
    for (const path of opened) {
      destination.searchParams.append("open", path === entityPath(previousId) ? entityPath(savedId) : path);
    }
    if (destination.hash === `#${encodeURIComponent(`entity-${previousId}`)}`) {
      destination.hash = encodeURIComponent(`entity-${savedId}`);
    }
    viewer.set("list", `${destination.pathname}${destination.search}${destination.hash}`);
  }
  return {
    path: `${entityPath(savedId)}?${viewer}`,
    options: { replace: true, state: { rekeyedDetail: location.pathname } },
  };
}

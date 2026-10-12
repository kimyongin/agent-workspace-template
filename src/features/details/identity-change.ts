import { rekeyEntityDetailLink } from "../../lib/entity-list-url.ts";
import type { NavigateOptions } from "react-router";

/** The URL module owns list representation; the workspace owns retained-tab transfer metadata. */
export function replaceEntityDetailVisit(
  location: { pathname: string; search: string; hash?: string },
  previousId: string,
  savedId: string,
): { path: string; options: NavigateOptions } {
  return {
    path: rekeyEntityDetailLink(location, previousId, savedId),
    options: { replace: true, state: { rekeyedDetail: location.pathname } },
  };
}

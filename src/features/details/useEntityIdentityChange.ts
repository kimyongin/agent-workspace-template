import { useLocation } from "react-router";
import { useDeferredNavigation } from "../../lib/useDeferredNavigation.ts";
import { replaceEntityDetailVisit } from "./identity-change.ts";

/** Remove the ended editor's guard before replacing either a tab or a browser visit. */
export function useEntityIdentityChange(discardEditor: () => void) {
  const location = useLocation();
  const afterClose = useDeferredNavigation();
  return (previousId: string, savedId: string) => {
    const replacement = replaceEntityDetailVisit(location, previousId, savedId);
    discardEditor();
    afterClose(replacement.path, replacement.options);
  };
}

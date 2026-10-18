import { detailModeLink } from "../../lib/entity-list-url.ts";
import { useEffect, useRef, useState } from "react";
import { useLocation, useSearchParams } from "../../lib/workspace-router.tsx";
import { useDetailNavigate } from "../../lib/detail-exploration.tsx";

/** Owns ordinary edit mode. Business actions and return destinations stay with their callers. */
export function useDetailEditor(onClosed: () => void) {
  const location = useLocation();
  const [params] = useSearchParams();
  const navigate = useDetailNavigate();
  const latestClosed = useRef(onClosed);
  latestClosed.current = onClosed;
  const [endedEntry, setEndedEntry] = useState<string | null>(null);
  const [destination, setDestination] = useState<{ key: string; path: string } | null>(null);
  const active = params.get("edit") === "1" && endedEntry !== location.key;

  // Suppression belongs to this visit, not to a history entry revisited by Back/Forward.
  useEffect(() => { setEndedEntry(null); }, [location.key]);

  // Form layout cleanup has removed the editor and its dirty guard before this effect runs.
  useEffect(() => {
    if (!destination) return;
    setDestination(null);
    if (destination.key === location.key) navigate(destination.path, { replace: true });
  }, [destination, location.key, navigate]);

  const discard = () => setEndedEntry(location.key);
  const leave = (path: string) => {
    discard();
    setDestination({ key: location.key, path });
  };
  const close = (pathname = location.pathname) => {
    const viewer = new URLSearchParams(params);
    viewer.delete("edit");
    viewer.delete("edit_from");
    latestClosed.current();
    leave(detailModeLink(pathname, viewer, location.hash));
  };
  const start = () => {
    const next = new URLSearchParams(params);
    next.set("edit", "1");
    next.delete("edit_from");
    navigate(detailModeLink(location.pathname, next, location.hash));
  };
  return { active, start, close, leave, formProps: { onClose: () => close(), onRouteDiscard: discard } };
}

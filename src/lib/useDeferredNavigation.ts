import { useEffect, useState } from "react";
import type { NavigateOptions } from "./workspace-router.tsx";
import { useDetailNavigate } from "./detail-exploration.tsx";

/** Commit the dialog removal before navigating, so its dirty route guard is removed first. */
export function useDeferredNavigation() {
  const navigate = useDetailNavigate();
  const [destination, setDestination] = useState<{path:string;options:NavigateOptions} | null>(null);
  useEffect(() => {
    if (!destination) return;
    setDestination(null);
    navigate(destination.path, destination.options);
  }, [destination,navigate]);
  return (path:string, options:boolean | NavigateOptions=false) => setDestination({path,options:typeof options === "boolean" ? {replace:options} : options});
}

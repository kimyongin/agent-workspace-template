import { useEffect, useState } from "react";
import { useDetailNavigate } from "./detail-exploration.tsx";

/** Commit the dialog removal before navigating, so its dirty route guard is removed first. */
export function useDeferredNavigation() {
  const navigate = useDetailNavigate();
  const [destination, setDestination] = useState<{path:string;replace:boolean} | null>(null);
  useEffect(() => {
    if (!destination) return;
    setDestination(null);
    navigate(destination.path, {replace:destination.replace});
  }, [destination,navigate]);
  return (path:string, replace=false) => setDestination({path,replace});
}

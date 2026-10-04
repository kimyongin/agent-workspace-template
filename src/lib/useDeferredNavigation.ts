import { useEffect, useState } from "react";
import { useNavigate } from "react-router";

/** Commit the dialog removal before navigating, so its dirty route guard is removed first. */
export function useDeferredNavigation() {
  const navigate = useNavigate();
  const [destination, setDestination] = useState<{path:string;replace:boolean} | null>(null);
  useEffect(() => {
    if (!destination) return;
    setDestination(null);
    navigate(destination.path, {replace:destination.replace});
  }, [destination,navigate]);
  return (path:string, replace=false) => setDestination({path,replace});
}

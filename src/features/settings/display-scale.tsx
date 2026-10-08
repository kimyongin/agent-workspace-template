import { createContext, useCallback, useContext, useLayoutEffect, useState, type ReactNode } from "react";
import { useAuth } from "../auth/AuthProvider.tsx";
import { accountPreferences, type DisplayScale } from "./account-preferences.ts";

const DisplayContext = createContext<{ scale: DisplayScale; preview: (scale: DisplayScale | null) => void }>({ scale: 100, preview: () => {} });

/** One account-scoped owner for confirmed display size and a temporary settings preview. */
export function DisplayScaleProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const account = session?.user.id ?? null;
  const saved = accountPreferences(session?.user.user_metadata ?? {}).displayScale;
  const [preview, setPreview] = useState<{ account: string; scale: DisplayScale } | null>(null);
  const scale = account && preview?.account === account ? preview.scale : saved;
  const update = useCallback((value: DisplayScale | null) => {
    setPreview(previous => value !== null && account ? { account, scale: value } : previous?.account === account ? null : previous);
  }, [account]);
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--display-scale", String(scale / 100));
    return () => { root.style.removeProperty("--display-scale"); };
  }, [scale]);
  return <DisplayContext.Provider value={{ scale, preview: update }}>{children}</DisplayContext.Provider>;
}

export function useDisplayScale() { return useContext(DisplayContext).scale; }

export function useDisplayScalePreview(scale: DisplayScale) {
  const { preview: update } = useContext(DisplayContext);
  useLayoutEffect(() => { update(scale); return () => update(null); }, [scale, update]);
}

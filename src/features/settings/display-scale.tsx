import { createContext, useCallback, useContext, useLayoutEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { useAuth } from "../auth/AuthProvider.tsx";
import { accountPreferences, type DisplayScale } from "./account-preferences.ts";

type Scales = { desktop: DisplayScale; mobile: DisplayScale };
const desktopQuery = window.matchMedia("(min-width: 1024px)");
const subscribe = (notify: () => void) => {
  desktopQuery.addEventListener("change", notify);
  return () => desktopQuery.removeEventListener("change", notify);
};
const DisplayContext = createContext<{ scale: DisplayScale; preview: (scales: Scales | null) => void }>({ scale: 100, preview: () => {} });

/** One account-scoped owner for confirmed display size and a temporary settings preview. */
export function DisplayScaleProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const account = session?.user.id ?? null;
  const saved = accountPreferences(session?.user.user_metadata ?? {});
  const desktop = useSyncExternalStore(subscribe, () => desktopQuery.matches, () => false);
  const [preview, setPreview] = useState<{ account: string; scales: Scales } | null>(null);
  const scales = account && preview?.account === account ? preview.scales : { desktop: saved.desktopDisplayScale, mobile: saved.mobileDisplayScale };
  const scale = desktop ? scales.desktop : scales.mobile;
  const update = useCallback((value: Scales | null) => {
    setPreview(previous => value !== null && account ? { account, scales: value } : previous?.account === account ? null : previous);
  }, [account]);
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--display-scale", String(scale / 100));
    return () => { root.style.removeProperty("--display-scale"); };
  }, [scale]);
  return <DisplayContext.Provider value={{ scale, preview: update }}>{children}</DisplayContext.Provider>;
}

export function useDisplayScale() { return useContext(DisplayContext).scale; }

export function useDisplayScalePreview(desktop: DisplayScale, mobile: DisplayScale) {
  const { preview: update } = useContext(DisplayContext);
  useLayoutEffect(() => { update({ desktop, mobile }); return () => update(null); }, [desktop, mobile, update]);
}

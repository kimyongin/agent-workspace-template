import { createContext, type ReactNode, useContext, useState } from "react";
import type { NavigationPreference } from "./account-preferences.ts";
const NavigationPreviewContext = createContext<{
  preview: NavigationPreference | null | undefined;
  setPreview: (value: NavigationPreference | null | undefined) => void;
}>({ preview: undefined, setPreview: () => {} });
export function NavigationPreviewProvider({ children }: { children: ReactNode }) {
  const [preview, setPreview] = useState<NavigationPreference | null | undefined>(undefined);
  return (
    <NavigationPreviewContext.Provider value={{ preview, setPreview }}>{children}</NavigationPreviewContext.Provider>
  );
}
export const useNavigationPreview = () => useContext(NavigationPreviewContext);

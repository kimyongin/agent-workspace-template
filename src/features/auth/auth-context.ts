import type { Session } from "@supabase/supabase-js";
import { createContext } from "react";
import type { AccountPreferences } from "../settings/account-preferences.ts";
interface AuthState {
  session: Session | null;
  loading: boolean;
  savePreferences: (changes: Partial<AccountPreferences>) => Promise<AccountPreferences>;
}
/** Reading display state must not initialize the network SDK. */
export const AuthContext = createContext<AuthState>({
  session: null, loading: true,
  savePreferences: async () => { throw new Error("로그인이 필요합니다."); },
});

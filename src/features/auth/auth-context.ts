import type { Session } from "@supabase/supabase-js";
import { createContext } from "react";
import type { ProfileIconId } from "../settings/profile.tsx";
interface AuthState {
  session: Session | null;
  loading: boolean;
  saveProfileIcon: (id: ProfileIconId) => Promise<ProfileIconId>;
  saveTimezone: (timezone: string | null) => Promise<string | null>;
}
/** Reading display state must not initialize the network SDK. */
export const AuthContext = createContext<AuthState>({
  session: null, loading: true,
  saveProfileIcon: async () => { throw new Error("로그인이 필요합니다."); },
  saveTimezone: async () => { throw new Error("로그인이 필요합니다."); },
});

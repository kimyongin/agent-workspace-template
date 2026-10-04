// 앱 세션 상태. Supabase Auth 세션만 다루며 권한 판단은 서버가 한다.
import type { Session } from "@supabase/supabase-js";
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react";
import { Navigate, useLocation } from "react-router";
import { supabase } from "../../lib/supabase.ts";
import { profileIconId, type ProfileIconId } from "../settings/profile.tsx";
import { profileClient, ProfileDisplayRefreshError } from "./profile-client.ts";

interface AuthState {
  session: Session | null;
  loading: boolean;
  saveProfileIcon: (id: ProfileIconId) => Promise<ProfileIconId>;
}

const AuthContext = createContext<AuthState>({ session: null, loading: true, saveProfileIcon: async () => { throw new Error("로그인이 필요합니다."); } });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ session: Session | null; loading: boolean }>({ session: null, loading: true });
  const activeSession = useRef<Session | null>(null);
  const accountGeneration = useRef(0);
  useEffect(() => {
    let alive = true;
    let eventReceived = false;
    const apply = (session: Session | null) => {
      if (!alive) return;
      if (activeSession.current?.user.id !== session?.user.id) accountGeneration.current++;
      activeSession.current = session;
      setState({ session, loading: false });
    };
    const { data } = supabase.auth.onAuthStateChange((_event, session) => { eventReceived = true; apply(session); });
    void supabase.auth.getSession().then(({ data, error }) => {
      if (!eventReceived) apply(error ? null : data.session);
    }).catch(() => { if (!eventReceived) apply(null); });
    return () => { alive = false; accountGeneration.current++; data.subscription.unsubscribe(); };
  }, []);
  const saveProfileIcon = async (id: ProfileIconId) => {
    const original = activeSession.current;
    const generation = accountGeneration.current;
    if (!original) throw new Error("로그인이 필요합니다.");
    const assertAccount = () => {
      if (activeSession.current?.user.id !== original.user.id || generation !== accountGeneration.current) throw new Error("로그인 계정이 변경되었습니다.");
    };
    // 먼저 현재 SDK 세션을 조회한다. 공유 refresh token을 개인 클라이언트가 회전시키지 않는다.
    const current = await supabase.auth.getSession();
    assertAccount();
    if (current.error) throw current.error;
    if (current.data.session?.user.id !== original.user.id) throw new Error("로그인 계정이 변경되었습니다.");
    const client = profileClient(current.data.session);
    try {
      const { data, error } = await client.updateUser({ data: { workspace_avatar_id: id } });
      assertAccount();
      if (error) throw error;
      if (data.user?.id !== original.user.id) throw new Error("로그인 계정이 변경되었습니다.");
      // 공유 SDK의 refresh는 저장소 변경을 검사한다(고정 SDK 2.117.2).
      // 이전 계정 토큰을 setSession으로 다시 주입하지 않고 현재 세션만 새로 조회한다.
      const refreshed = await supabase.auth.refreshSession();
      assertAccount();
      if (refreshed.error || refreshed.data.session?.user.id !== original.user.id) throw new ProfileDisplayRefreshError();
      return profileIconId(refreshed.data.session.user.user_metadata.workspace_avatar_id);
    } finally { await client.dispose(); }
  };
  return <AuthContext.Provider value={{ ...state, saveProfileIcon }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);

/** 로그인하지 않았으면 로그인 화면으로 보내고, 로그인 뒤 원래 위치로 돌아온다. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();
  const location = useLocation();
  if (loading) return <p className="secondary" role="status">로그인 상태를 확인하는 중…</p>;
  if (!session) {
    const next = `${location.pathname}${location.search}`;
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
  }
  return <>{children}</>;
}

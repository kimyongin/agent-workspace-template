// 앱 세션 상태. Supabase Auth 세션만 다루며 권한 판단은 서버가 한다.
import type { Session } from "@supabase/supabase-js";
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react";
import { Navigate, useLocation } from "react-router";
import { supabase } from "../../lib/supabase.ts";
import type { ProfileIconId } from "../settings/profile.tsx";

interface AuthState {
  session: Session | null;
  loading: boolean;
  saveProfileIcon: (id: ProfileIconId) => Promise<void>;
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
    return () => { alive = false; data.subscription.unsubscribe(); };
  }, []);
  const saveProfileIcon = async (id: ProfileIconId) => {
    const original = activeSession.current;
    const generation = accountGeneration.current;
    if (!original) throw new Error("로그인이 필요합니다.");
    const { data, error } = await supabase.auth.updateUser({ data: { workspace_avatar_id: id } });
    if (error) throw error;
    if (!data.user || data.user.id !== original.user.id || activeSession.current?.user.id !== original.user.id || generation !== accountGeneration.current) throw new Error("로그인 계정이 변경되었습니다.");
    const session = { ...activeSession.current, user: data.user };
    activeSession.current = session;
    setState({ session, loading: false });
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

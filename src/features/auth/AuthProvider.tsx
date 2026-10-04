// 앱 세션 상태. Supabase Auth 세션만 다루며 권한 판단은 서버가 한다.
import type { Session } from "@supabase/supabase-js";
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react";
import { Navigate, useLocation } from "react-router";
import { supabase } from "../../lib/supabase.ts";
import type { ProfileIconId } from "../settings/profile.tsx";
import { profileClient, readProfile, ProfileDisplayRefreshError } from "./profile-client.ts";

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
  const profileRevision = useRef(0);
  const channel = useRef<BroadcastChannel | null>(null);
  const applyIcon = (id: ProfileIconId) => {
    const session = activeSession.current;
    if (!session) return;
    // 표시용 필드만 복사한다. 토큰·권한·SDK 세션 저장소는 프로필 흐름이 변경하지 않는다.
    const display = { ...session, user: { ...session.user, user_metadata: { ...session.user.user_metadata, workspace_avatar_id: id } } };
    activeSession.current = display;
    setState({ session: display, loading: false });
  };
  useEffect(() => {
    let alive = true;
    let eventReceived = false;
    const hydrate = async () => {
      const session = activeSession.current;
      const generation = accountGeneration.current;
      const revision = ++profileRevision.current;
      if (!session) return;
      try {
        const icon = await readProfile(session);
        if (alive && generation === accountGeneration.current && revision === profileRevision.current && activeSession.current?.access_token === session.access_token) applyIcon(icon);
      } catch { /* 읽기 실패는 기존 표시를 유지한다. 저장 뒤 실패는 별도로 안내한다. */ }
    };
    const apply = (session: Session | null) => {
      if (!alive) return;
      if (activeSession.current?.user.id !== session?.user.id) accountGeneration.current++;
      activeSession.current = session;
      setState({ session, loading: false });
      // Auth 콜백의 SDK 잠금 밖에서, 별도 클라이언트로 서버 정본을 읽는다.
      queueMicrotask(() => { if (alive) void hydrate(); });
    };
    const { data } = supabase.auth.onAuthStateChange((_event, session) => { eventReceived = true; apply(session); });
    void supabase.auth.getSession().then(({ data, error }) => {
      if (!eventReceived) apply(error ? null : data.session);
    }).catch(() => { if (!eventReceived) apply(null); });
    const updates = new BroadcastChannel("workspace-decorative-profile");
    channel.current = updates;
    updates.onmessage = event => {
      if (event.data === activeSession.current?.user.id) void hydrate();
    };
    return () => { alive = false; accountGeneration.current++; profileRevision.current++; channel.current = null; updates.close(); data.subscription.unsubscribe(); };
  }, []);
  const saveProfileIcon = async (id: ProfileIconId) => {
    const original = activeSession.current;
    const generation = accountGeneration.current;
    if (!original) throw new Error("로그인이 필요합니다.");
    const assertAccount = () => {
      if (activeSession.current?.user.id !== original.user.id || generation !== accountGeneration.current) throw new Error("로그인 계정이 변경되었습니다.");
    };
    ++profileRevision.current;
    const client = profileClient(original);
    try {
      const { data, error } = await client.updateUser({ data: { workspace_avatar_id: id } });
      assertAccount();
      if (error) throw error;
      if (data.user?.id !== original.user.id) throw new Error("로그인 계정이 변경되었습니다.");
      // 저장 알림에는 계정 ID만 담는다. 수신 탭도 자기 토큰으로 서버 표시를 읽는다.
      channel.current?.postMessage(original.user.id);
      let icon: ProfileIconId;
      try { icon = await readProfile(original); }
      catch { assertAccount(); throw new ProfileDisplayRefreshError(); }
      assertAccount();
      ++profileRevision.current;
      applyIcon(icon);
      return icon;
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

import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { supabase } from "../../lib/supabase.ts";
import { useAuth } from "./AuthProvider.tsx";

// 먼저 경로 이동으로 초안 보호를 통과한다. 로그아웃은 이 페이지 진입 후에만 실행한다.
export function LogoutPage() {
  const navigate = useNavigate();
  const { session, loading } = useAuth();
  const started = useRef(false);
  const [error, setError] = useState(false);
  const [localSignedOut, setLocalSignedOut] = useState(false);
  const signOut = async () => {
    setError(false);
    try {
      const result = await supabase.auth.signOut();
      if (result.error) throw result.error;
      navigate("/login", { replace: true });
    } catch {
      // 현재 SDK는 원격 실패에도 로컬 세션을 지울 수 있다. 실제 남은 상태를 안내한다.
      const { data } = await supabase.auth.getSession();
      setLocalSignedOut(!data.session);
      setError(true);
    }
  };
  useEffect(() => {
    if (loading) return;
    // 로그아웃 후 RequireAuth의 next=/logout 복귀를 만들지 않는다.
    if (!session) {
      if (!started.current) navigate("/login", { replace: true });
      return;
    }
    if (!started.current) { started.current = true; void signOut(); }
  }, [loading, session, navigate]);
  return <section className="panel">
    <h1 className="page-title">로그아웃</h1>
    {error ? <>
      <p className="error-text" role="alert">{localSignedOut ? "이 기기에서는 로그아웃했습니다. 서버의 다른 세션 로그아웃은 확인하지 못했습니다." : "로그아웃하지 못했습니다. 다시 시도하세요."}</p>
      {localSignedOut ? <Link className="btn" to="/login">로그인으로 이동</Link>
        : <div className="actions"><button className="btn" onClick={signOut}>다시 시도</button><Link className="btn" to="/tasks">할 일로 돌아가기</Link></div>}
    </> : <p className="secondary" role="status">로그아웃 중…</p>}
  </section>;
}

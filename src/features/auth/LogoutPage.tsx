import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { supabase } from "../../lib/supabase.ts";

// 먼저 경로 이동으로 초안 보호를 통과한다. 로그아웃은 이 페이지 진입 후에만 실행한다.
export function LogoutPage() {
  const navigate = useNavigate();
  const started = useRef(false);
  const [error, setError] = useState(false);
  const signOut = async () => {
    setError(false);
    try {
      const result = await supabase.auth.signOut();
      if (result.error) throw result.error;
      navigate("/login", { replace: true });
    } catch { setError(true); }
  };
  useEffect(() => {
    if (!started.current) { started.current = true; void signOut(); }
  }, []);
  return <section className="panel">
    <h1 className="page-title">로그아웃</h1>
    {error ? <>
      <p className="error-text" role="alert">로그아웃하지 못했습니다. 다시 시도하세요.</p>
      <div className="actions"><button className="btn" onClick={signOut}>다시 시도</button><Link className="btn" to="/tasks">할 일로 돌아가기</Link></div>
    </> : <p className="secondary" role="status">로그아웃 중…</p>}
  </section>;
}

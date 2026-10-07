// 로그인: Google OAuth(기본). 로컬 개발·E2E에서만 이메일 로그인 폼을 보인다(티켓의 로컬 대체).
import { type FormEvent, useState } from "react";
import { Navigate, useSearchParams } from "react-router";
import { Field, Notice } from "../../components/Field.tsx";
import { devLoginEnabled, supabase } from "../../lib/supabase.ts";
import { useAuth } from "./AuthProvider.tsx";

/** 로그인 뒤 돌아갈 경로. 앱 내부 경로만 허용한다(임의 redirect 금지). */
function safeNext(value: string | null): string {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : "/tasks";
}

export function LoginPage() {
  const { session } = useAuth();
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (session) return <Navigate to={next} replace />;

  const google = async () => {
    setError(null);
    const redirectTo = new URL(`${import.meta.env.BASE_URL}login?next=${encodeURIComponent(next)}`, window.location.origin)
      .href;
    const { error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo } });
    if (error) setError("Google 로그인을 시작하지 못했습니다. 로그인 설정을 확인하세요.");
  };

  const devLogin = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) setError("이메일 또는 비밀번호가 맞지 않습니다.");
  };

  return (
    <section className="panel auth-panel" aria-labelledby="login-title" style={{ maxWidth: "28rem", margin: "0 auto", width: "100%" }}>
      <h1 id="login-title" className="page-title">로그인</h1>
      {error && <Notice kind="error">{error}</Notice>}
      <button type="button" className="btn btn-primary" onClick={google}>Google로 로그인</button>
      {devLoginEnabled && (
        <form className="form auth-alternative" onSubmit={devLogin} aria-labelledby="dev-login-title">
          <h2 id="dev-login-title" className="section-title">개발용 로그인</h2>
          <p className="help" style={{ margin: 0 }}>로컬 개발 환경에서 사용하는 계정으로 로그인하세요.</p>
          <Field label="이메일" required>
            {(p) => (
              <input {...p} className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
            )}
          </Field>
          <Field label="비밀번호" required>
            {(p) => (
              <input
                {...p}
                className="input"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            )}
          </Field>
          <button type="submit" className="btn" disabled={busy}>{busy ? "로그인 중…" : "이메일로 로그인"}</button>
        </form>
      )}
    </section>
  );
}

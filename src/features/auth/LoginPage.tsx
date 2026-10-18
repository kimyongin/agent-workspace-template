// 로그인: Google OAuth(기본). 로컬 개발·E2E에서만 이메일 로그인 폼을 보인다(티켓의 로컬 대체).
import { type FormEvent, useId, useState } from "react";
import { Navigate, useSearchParams } from "react-router";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { devLoginEnabled, supabase } from "../../lib/supabase.ts";
import { useAuth } from "./AuthProvider.tsx";

/** 로그인 뒤 돌아갈 경로. 앱 내부 경로만 허용한다(임의 redirect 금지). */
function safeNext(value: string | null): string {
  return value && value.startsWith("/") && !value.startsWith("//") && !value.includes("\\") ? value : "/workspaces";
}

export function LoginPage() {
  const { session } = useAuth();
  const emailId = useId(), passwordId = useId();
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
    <section className="mx-auto w-full min-w-0 max-w-md px-4 py-6 sm:px-0" aria-labelledby="login-title">
      <Card>
        <CardHeader>
          <CardTitle><h1 id="login-title">로그인</h1></CardTitle>
          <CardDescription>내 자료와 할 일·기록을 관리하려면 로그인하세요.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
          <Button type="button" size="lg" className="w-full" onClick={google}>Google로 로그인</Button>
          {devLoginEnabled && <>
            <Separator />
            <form onSubmit={devLogin} aria-labelledby="dev-login-title">
              <FieldGroup>
                <h2 id="dev-login-title">개발용 로그인</h2>
                <Field>
                  <FieldLabel htmlFor={emailId}>이메일 <span className="sr-only">(필수)</span></FieldLabel>
                  <Input id={emailId} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
                </Field>
                <Field>
                  <FieldLabel htmlFor={passwordId}>비밀번호 <span className="sr-only">(필수)</span></FieldLabel>
                  <Input id={passwordId} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
                </Field>
                <Field>
                  <Button type="submit" variant="outline" size="lg" className="w-full" disabled={busy}>
                    {busy && <Spinner aria-hidden="true" data-icon="inline-start" />}
                    {busy ? "로그인 중…" : "이메일로 로그인"}
                  </Button>
                </Field>
              </FieldGroup>
            </form>
          </>}
        </CardContent>
        <CardFooter><CardDescription>내 계정으로 로그인해 업무를 이어가세요.</CardDescription></CardFooter>
      </Card>
    </section>
  );
}

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
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
  return <section className="mx-auto w-full min-w-0 max-w-md px-4 py-6 sm:px-0" aria-labelledby="logout-title">
    <Card>
      <CardHeader>
        <CardTitle><h1 id="logout-title">로그아웃</h1></CardTitle>
        <CardDescription>로그인 상태를 종료하고 로그인 화면으로 이동합니다.</CardDescription>
      </CardHeader>
      <CardContent>
        {error
          ? <Alert variant="destructive"><AlertDescription>{localSignedOut ? "이 기기에서는 로그아웃했습니다. 서버의 다른 세션 로그아웃은 확인하지 못했습니다." : "로그아웃하지 못했습니다. 다시 시도하세요."}</AlertDescription></Alert>
          : <div role="status" className="flex items-center gap-2"><Spinner aria-hidden="true" />로그아웃 중…</div>}
      </CardContent>
      {error && <CardFooter className="flex flex-wrap gap-2">
        {localSignedOut
          ? <Button asChild size="lg"><Link to="/login">로그인으로 이동</Link></Button>
          : <>
            <Button type="button" variant="outline" size="lg" onClick={signOut}>다시 시도</Button>
            <Button asChild variant="ghost" size="lg"><Link to="/workspaces">내 공간으로 돌아가기</Link></Button>
          </>}
      </CardFooter>}
    </Card>
  </section>;
}

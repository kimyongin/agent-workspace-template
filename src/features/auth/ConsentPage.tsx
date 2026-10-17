// MCP OAuth 동의 화면(/oauth/consent). Supabase OAuth 서버가 authorization_id와 함께 보낸다.
// 클라이언트 이름과 돌아갈 주소를 보여 주고 사용자가 승인·거부한다(T02-1 실험 2의 채택 방식).
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { supabase } from "../../lib/supabase.ts";
import { useAuth } from "./AuthProvider.tsx";

interface Details {
  /** Supabase Auth 응답: client.id·client.name(동적 등록 때 클라이언트가 보낸 이름). */
  client?: { id?: string; name?: string; uri?: string };
  redirect_uri?: string;
  scope?: string;
}

export function ConsentPage() {
  const [params] = useSearchParams();
  const authorizationId = params.get("authorization_id");
  const userId = useAuth().session?.user.id;
  const request = useRef<{
    authorizationId: string;
    userId: string;
    promise: ReturnType<typeof supabase.auth.oauth.getAuthorizationDetails>;
  } | null>(null);
  const [loaded, setLoaded] = useState<{ authorizationId: string; userId: string; details: Details } | null>(null);
  const details = loaded?.authorizationId === authorizationId && loaded.userId === userId ? loaded.details : null;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    setError(null);
    setBusy(false);
    if (!authorizationId) {
      setError("인가 요청 정보가 없습니다. 에이전트에서 연결을 다시 시작하세요.");
      return;
    }
    if (!userId) return;
    // StrictMode replays effects. Share this component's request so consent cannot
    // race another details GET holding Supabase Auth's authorization row lock.
    if (request.current?.authorizationId !== authorizationId || request.current.userId !== userId) {
      request.current = { authorizationId, userId, promise: supabase.auth.oauth.getAuthorizationDetails(authorizationId) };
    }
    request.current.promise.then(({ data, error }) => {
      if (!active) return;
      if (error || !data) return setError("인가 요청을 찾을 수 없거나 만료되었습니다. 에이전트에서 다시 시작하세요.");
      // 이미 승인한 클라이언트면 바로 돌아간다.
      if ("redirect_url" in data && data.redirect_url) {
        window.location.assign(data.redirect_url as string);
        return;
      }
      setLoaded({ authorizationId, userId, details: data as Details });
    });
    return () => { active = false; };
  }, [authorizationId, userId]);

  const decide = async (approve: boolean) => {
    if (!authorizationId) return;
    setBusy(true);
    setError(null);
    const { error } = approve
      ? await supabase.auth.oauth.approveAuthorization(authorizationId)
      : await supabase.auth.oauth.denyAuthorization(authorizationId);
    // 성공하면 supabase-js가 클라이언트의 redirect 주소로 이동시킨다.
    if (error) {
      setBusy(false);
      setError("처리하지 못했습니다. 다시 시도하세요.");
    }
  };

  const name = details?.client?.name || details?.client?.id || "알 수 없는 클라이언트";
  return (
    <section className="mx-auto w-full min-w-0 max-w-lg px-4 py-6 sm:px-0" aria-labelledby="consent-title">
      <Card>
        <CardHeader>
          <CardTitle><h1 id="consent-title">에이전트 연결 승인</h1></CardTitle>
          <CardDescription>연결할 에이전트와 요청 범위를 확인하고 접근을 허용합니다.</CardDescription>
        </CardHeader>
        <CardContent className="flex min-w-0 flex-col gap-5">
          {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
          {!details && !error && <div role="status" className="flex items-center gap-2"><Spinner aria-hidden="true" />요청을 확인하는 중…</div>}
          {details && <>
            <Alert>
              <AlertTitle>계정 데이터 접근 요청</AlertTitle>
              <AlertDescription>이 에이전트가 내 할 일과 기록을 조회하고 변경하려고 합니다.</AlertDescription>
            </Alert>
            <CardDescription>클라이언트 이름은 등록한 쪽이 정한 값이므로 돌아갈 주소와 함께 확인하세요.</CardDescription>
            <dl className="flex min-w-0 flex-col gap-4">
              <div className="flex min-w-0 flex-col gap-1"><dt>클라이언트</dt><dd className="min-w-0 [overflow-wrap:anywhere]">{name}</dd></div>
              <div className="flex min-w-0 flex-col gap-1"><dt>돌아갈 주소</dt><dd className="min-w-0 [overflow-wrap:anywhere]">{details.redirect_uri ?? "—"}</dd></div>
              <div className="flex min-w-0 flex-col gap-1"><dt>요청 범위</dt><dd className="min-w-0 [overflow-wrap:anywhere]">{details.scope || "기본"}</dd></div>
            </dl>
            <Separator />
            <CardDescription>직접 시작한 연결이 아니거나 돌아갈 주소를 모르면 거부하세요. 승인은 에이전트가 이 계정의 데이터에 접근하도록 허용합니다.</CardDescription>
          </>}
        </CardContent>
        {details && <CardFooter className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" size="lg" className="min-w-16" onClick={() => decide(false)} disabled={busy}>거부</Button>
          <Button type="button" size="lg" className="min-w-16" onClick={() => decide(true)} disabled={busy}>
            {busy && <Spinner aria-hidden="true" data-icon="inline-start" />}{busy ? "처리 중…" : "승인"}
          </Button>
        </CardFooter>}
      </Card>
    </section>
  );
}

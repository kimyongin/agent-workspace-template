// MCP OAuth 동의 화면(/oauth/consent). Supabase OAuth 서버가 authorization_id와 함께 보낸다.
// 클라이언트 이름과 돌아갈 주소를 보여 주고 사용자가 승인·거부한다(T02-1 실험 2의 채택 방식).
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { Notice } from "../../components/Field.tsx";
import { supabase } from "../../lib/supabase.ts";

interface Details {
  /** Supabase Auth 응답: client.id·client.name(동적 등록 때 클라이언트가 보낸 이름). */
  client?: { id?: string; name?: string; uri?: string };
  redirect_uri?: string;
  scope?: string;
}

export function ConsentPage() {
  const [params] = useSearchParams();
  const authorizationId = params.get("authorization_id");
  const [details, setDetails] = useState<Details | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!authorizationId) {
      setError("인가 요청 정보가 없습니다. 에이전트에서 연결을 다시 시작하세요.");
      return;
    }
    supabase.auth.oauth.getAuthorizationDetails(authorizationId).then(({ data, error }) => {
      if (error || !data) return setError("인가 요청을 찾을 수 없거나 만료되었습니다. 에이전트에서 다시 시작하세요.");
      // 이미 승인한 클라이언트면 바로 돌아간다.
      if ("redirect_url" in data && data.redirect_url) {
        window.location.assign(data.redirect_url as string);
        return;
      }
      setDetails(data as Details);
    });
  }, [authorizationId]);

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
    <section className="panel" aria-labelledby="consent-title" style={{ maxWidth: "32rem", margin: "0 auto", width: "100%" }}>
      <h1 id="consent-title" className="page-title">에이전트 연결 승인</h1>
      {error && <Notice kind="error">{error}</Notice>}
      {!details && !error && <p className="secondary" role="status">요청을 확인하는 중…</p>}
      {details && (
        <>
          <p style={{ margin: 0 }}>
            <strong>{name}</strong>이(가) 내 할 일과 기록을 조회하고 변경하려고 합니다.
          </p>
          <p className="help" style={{ margin: 0 }}>클라이언트 이름은 등록한 쪽이 정한 값이므로 돌아갈 주소와 함께 확인하세요.</p>
          <dl className="props">
            <div>
              <dt>돌아갈 주소</dt>
              <dd>{details.redirect_uri ?? "—"}</dd>
            </div>
            <div>
              <dt>요청 범위</dt>
              <dd>{details.scope || "기본"}</dd>
            </div>
          </dl>
          <p className="help" style={{ margin: 0 }}>
            직접 시작한 연결이 아니거나 돌아갈 주소를 모르면 거부하세요. 승인은 에이전트가 이 계정의 데이터에 접근하도록 허용합니다.
          </p>
          <div className="actions">
            <button type="button" className="btn" onClick={() => decide(false)} disabled={busy}>거부</button>
            <button type="button" className="btn btn-primary" onClick={() => decide(true)} disabled={busy}>
              {busy ? "처리 중…" : "승인"}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

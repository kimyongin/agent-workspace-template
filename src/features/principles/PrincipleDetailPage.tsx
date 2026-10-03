import { principleLabels, type PrincipleResult } from "@contracts/principle.ts";
import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { Notice } from "../../components/Field.tsx";
import { MarkdownContent } from "../../components/MarkdownContent.tsx";
import { api, ApiError } from "../../lib/api.ts";
import { formatDateTime } from "../../lib/format.ts";

export function PrincipleDetailPage() {
  const { id = "" } = useParams();
  const [params] = useSearchParams();
  const [item, setItem] = useState<PrincipleResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let alive = true;
    setItem(null); setError(null);
    api<PrincipleResult>("GET", `/principles/${id}`).then((p) => { if (alive) setItem(p); })
      .catch((e) => { if (alive) setError(e instanceof ApiError && e.code === "not_found" ? "원칙을 찾을 수 없습니다." : "원칙을 불러오지 못했습니다."); });
    return () => { alive = false; };
  }, [id, retry]);
  return <section className="panel" aria-labelledby={item ? "principle-title" : undefined}>
    <Link className="secondary back-link" to={`/principles?${params}#principle-${id}`}>← 원칙 목록</Link>
    {error && <><Notice kind="error">{error}</Notice><button type="button" className="btn" onClick={() => setRetry((n) => n + 1)}>다시 시도</button></>}
    {!item && !error && <p role="status" className="secondary">불러오는 중…</p>}
    {item && <>
      <h1 id="principle-title" className="page-title">{item.title}</h1>
      <dl className="props"><div><dt>상태</dt><dd>{principleLabels[item.status]}</dd></div>
        <div><dt>{principleLabels.applies_when}</dt><dd>{item.applies_when || "지정하지 않음"}</dd></div>
        <div><dt>{principleLabels.summary}</dt><dd>{item.summary}</dd></div></dl>
      <div><h2 className="section-title">본문</h2><MarkdownContent text={item.body} /></div>
      <p className="meta">수정 {formatDateTime(item.updated_at)}</p>
    </>}
  </section>;
}

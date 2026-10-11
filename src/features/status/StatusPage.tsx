import { useEffect, useRef, useState } from "react";
import type { StatusOverview } from "@contracts/status.ts";
import { api } from "../../lib/api.ts";
import { StatusContent } from "./StatusContent.tsx";
import "./status.css";
import { IndexingIssues } from "./IndexingIssues.tsx";

export function StatusPage() {
  const [data, setData] = useState<StatusOverview | null>(null);
  const [busy, setBusy] = useState(true), [error, setError] = useState("");
  const [issuesRevision, setIssuesRevision] = useState(0);
  const controller = useRef<AbortController | null>(null);
  async function refresh() {
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setBusy(true);
    setIssuesRevision((revision) => revision + 1);
    setError("");
    try {
      const next = await api<StatusOverview>("GET", "/status", undefined, request.signal);
      if (!request.signal.aborted) setData(next);
    } catch {
      if (!request.signal.aborted) setError("상태를 조회하지 못했습니다. 새로고침으로 다시 시도하세요.");
    } finally {
      if (!request.signal.aborted) setBusy(false);
    }
  }
  useEffect(() => {
    void refresh();
    return () => controller.current?.abort();
  }, []);
  const viewedAt = data
    ? new Intl.DateTimeFormat("ko-KR", { timeZone: data.timezone, dateStyle: "short", timeStyle: "medium" }).format(
      new Date(data.queried_at),
    )
    : null;
  return (
    <div className="status-page" aria-busy={busy}>
      <header className="status-header">
        <h1>상태</h1>
        <button className="btn" type="button" onClick={() => void refresh()} disabled={busy}>
          {busy ? "조회 중…" : "새로고침"}
        </button>
      </header>
      <div className="status-view-meta">
        <span className="meta">{data?.timezone ?? "Asia/Seoul"} · 서버 집계</span>
        <span className="meta" role="status">
          {busy ? "서버에서 상태를 조회하고 있습니다." : error ? "이번 조회 실패" : "이번 조회 연결 성공"}
        </span>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {data && (
        <>
          <p className="status-view-time meta">
            {busy || error ? "이전 조회" : "조회 시각"}: <time dateTime={data.queried_at}>{viewedAt}</time> 기준
          </p>
          <StatusContent data={data}>
            <IndexingIssues key={issuesRevision} count={data.indexing.attention} disabled={busy || !!error} />
          </StatusContent>
        </>
      )}
    </div>
  );
}

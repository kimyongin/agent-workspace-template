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
  return (
    <section className="panel status-page" aria-labelledby="status-title" aria-busy={busy}>
      <header className="panel-head">
        <h1 className="page-title" id="status-title">상태</h1>
        <button
          className="btn btn-text"
          type="button"
          aria-label="새로고침"
          title={busy ? "조회 중…" : "새로고침"}
          onClick={() => void refresh()}
          disabled={busy}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M20 11a8 8 0 0 0-14-5L3 9m0-6v6h6m-5 4a8 8 0 0 0 14 5l3-3m0 6v-6h-6" />
          </svg>
        </button>
      </header>
      {error && <p className="error" role="alert">{error}</p>}
      {data && (
        <StatusContent data={data}>
          <IndexingIssues key={issuesRevision} count={data.indexing.attention} disabled={busy || !!error} />
        </StatusContent>
      )}
    </section>
  );
}

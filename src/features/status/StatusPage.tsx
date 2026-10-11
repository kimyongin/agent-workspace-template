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
        <button className="btn" type="button" onClick={() => void refresh()} disabled={busy}>
          {busy ? "조회 중…" : "새로고침"}
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

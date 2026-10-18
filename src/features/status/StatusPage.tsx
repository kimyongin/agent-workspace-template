import { PageHeading } from "../../components/PageHeading.tsx";
import { useEffect, useRef, useState } from "react";
import type { StatusOverview } from "@contracts/status.ts";
import { api } from "../../lib/api.ts";
import { StatusContent } from "./StatusContent.tsx";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { RefreshCwIcon } from "lucide-react";
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
    <section className="@container flex min-w-0 flex-col gap-6" aria-labelledby="status-title" aria-busy={busy}>
      <PageHeading title="상태" id="status-title" description="저장된 데이터와 검색 준비 상태를 확인합니다.">
        <Button
          variant="outline"
          size="icon"
          aria-label="새로고침"
          title={busy ? "조회 중…" : "새로고침"}
          onClick={() => void refresh()}
          disabled={busy}
        >
          {busy ? <Spinner /> : <RefreshCwIcon />}
        </Button>
      </PageHeading>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {busy && !data && (
        <div role="status" aria-label="상태 조회 중" className="grid gap-4">
          <Skeleton className="h-72 w-full" />
          <Skeleton className="h-72 w-full" />
        </div>
      )}
      {data && (
        <StatusContent data={data}>
          <IndexingIssues key={issuesRevision} count={data.indexing.attention} disabled={busy || !!error} />
        </StatusContent>
      )}
    </section>
  );
}

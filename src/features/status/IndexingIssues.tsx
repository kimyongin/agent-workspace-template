import { useEffect, useId, useRef, useState } from "react";
import {
  type IndexingIssuesPage,
  indexingIssuesPage,
  indexingReasonExplanations,
  indexingReasonLabels,
} from "@contracts/status.ts";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { api } from "../../lib/api.ts";

export function IndexingIssues({ count, disabled = false }: { count: number; disabled?: boolean }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState<IndexingIssuesPage | null>(null);
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const [position, setPosition] = useState(0);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    request.current?.abort();
    if (!open || disabled) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError("");
    const cursor = cursors[position];
    void api<unknown>(
      "GET",
      `/status/indexing/issues${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
      undefined,
      controller.signal,
    )
      .then((value) => {
        if (!controller.signal.aborted) setPage(indexingIssuesPage.parse(value));
      })
      .catch(() => {
        if (!controller.signal.aborted) setError("색인 문제를 조회하지 못했습니다.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [open, disabled, cursors, position]);
  function toggle(nextOpen: boolean) {
    request.current?.abort();
    setOpen(nextOpen);
    setBusy(false);
  }
  function next() {
    if (!page?.next_cursor) return;
    setCursors([...cursors.slice(0, position + 1), page.next_cursor]);
    setPosition(position + 1);
  }
  return (
    <Collapsible open={open} onOpenChange={toggle} className="flex min-w-0 flex-col gap-4">
      <CollapsibleTrigger asChild>
        <Button variant="outline" className="w-full justify-between" disabled={disabled} aria-controls={id}>
          <span>색인 문제 {count.toLocaleString("ko-KR")}개</span>
          <span>{open ? "접기" : "펼치기"}</span>
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent
        id={id}
        role="region"
        aria-label="색인 문제 목록"
        aria-busy={busy}
        className="flex min-w-0 flex-col gap-4"
      >
        {busy && (
          <p role="status" className="flex items-center gap-2 text-sm">
            <Spinner />색인 문제 조회 중…
          </p>
        )}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>
              {error}
              <Button variant="outline" onClick={() => setCursors([...cursors])}>다시 시도</Button>
            </AlertDescription>
          </Alert>
        )}
        {page && !error && (
          <>
            {page.items.length === 0 && (
              <Empty role="status">
                <EmptyHeader>
                  <EmptyTitle>현재 확인이 필요한 색인 문제가 없습니다.</EmptyTitle>
                </EmptyHeader>
              </Empty>
            )}
            <Accordion type="multiple" className="min-w-0">
              {page.items.map((issue) => (
                <AccordionItem key={issue.id} value={issue.id}>
                  <AccordionTrigger className="min-w-0">
                    <span className="flex min-w-0 flex-wrap items-center gap-2 text-left">
                      <span className="min-w-0 wrap-anywhere whitespace-pre-wrap">
                        {issue.title || "제목 없는 기록"}
                      </span>
                      <Badge variant="secondary">{indexingReasonLabels[issue.reason]}</Badge>
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="flex flex-col gap-3">
                    <p>{indexingReasonExplanations[issue.reason]}</p>
                    {issue.chunks.unknown > 0 && (
                      <Alert>
                        <AlertDescription>
                          응답을 확인하지 못한 구간이 있습니다. 실패나 성공으로 확정할 수 없습니다.
                        </AlertDescription>
                      </Alert>
                    )}
                    <dl className="flex flex-wrap gap-x-6 gap-y-3 tabular-nums">
                      {([
                        ["현재 구간 전송 시도", `${issue.attempts}회`],
                        ["본문 구간", `${issue.chunks.succeeded}/${issue.chunks.total} 완료`],
                        ["준비 중", issue.chunks.preparing],
                        ["응답 확인 불가", issue.chunks.unknown],
                        ["확인된 실패", issue.chunks.failed],
                      ] as const).map(([label, value]) => (
                        <div key={label}>
                          <dt className="text-muted-foreground">{label}</dt>
                          <dd>{value}</dd>
                        </div>
                      ))}
                    </dl>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
            <nav className="flex flex-wrap items-center justify-between gap-2" aria-label="색인 문제 페이지">
              <Button variant="outline" disabled={busy || position === 0} onClick={() => setPosition(position - 1)}>
                이전
              </Button>
              <span className="text-sm text-muted-foreground" role="status">{position + 1}페이지 · 최대 5개</span>
              <Button variant="outline" disabled={busy || !page.next_cursor} onClick={next}>다음</Button>
            </nav>
          </>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

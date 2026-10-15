import { useEffect, useId, useRef, useState } from "react";
import {
  type IndexingIssuesPage,
  indexingIssuesPage,
  indexingReasonExplanations,
  indexingReasonLabels,
} from "@contracts/status.ts";
import { Notice } from "../../components/Field.tsx";
import { BodyAction } from "../../components/BodyAction.tsx";
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
  function toggle() {
    request.current?.abort();
    setOpen(!open);
    setBusy(false);
  }
  function next() {
    if (!page?.next_cursor) return;
    setCursors([...cursors.slice(0, position + 1), page.next_cursor]);
    setPosition(position + 1);
  }
  return (
    <div className="status-issues">
      <button
        className="status-issues-toggle"
        type="button"
        aria-expanded={open}
        aria-controls={id}
        disabled={disabled}
        onClick={toggle}
      >
        색인 문제 {count.toLocaleString("ko-KR")}개 · {open ? "접기" : "펼치기"}
      </button>
      {open && (
        <div id={id} aria-busy={busy}>
          {busy && <p role="status">색인 문제 조회 중…</p>}
          {error && (
            <div>
              <Notice kind="error">{error}</Notice>
              <button className="btn" type="button" onClick={() => setCursors([...cursors])}>다시 시도</button>
            </div>
          )}
          {page && !error && (
            <>
              {page.items.length === 0 && <p role="status">현재 확인이 필요한 색인 문제가 없습니다.</p>}
              <ul className="status-issue-list">
                {page.items.map((issue) => (
                  <li key={issue.id}>
                    <details>
                      <summary>
                        <strong>{issue.title || "제목 없는 기록"}</strong>
                        <span>{indexingReasonLabels[issue.reason]}</span>
                      </summary>
                      <p className="help">{indexingReasonExplanations[issue.reason]}</p>
                      {issue.chunks.unknown > 0 && (
                        <p className="help">
                          응답을 확인하지 못한 구간이 있습니다. 실패나 성공으로 확정할 수 없습니다.
                        </p>
                      )}
                      <p>
                        현재 구간 전송 시도 {issue.attempts}회 · 본문 구간 {issue.chunks.succeeded}/{issue.chunks.total}
                        {" "}
                        완료
                      </p>
                      <p className="meta">
                        준비 중 {issue.chunks.preparing} · 응답 확인 불가 {issue.chunks.unknown} · 확인된 실패{" "}
                        {issue.chunks.failed}
                      </p>
                    </details>
                  </li>
                ))}
              </ul>
              <nav className="status-issues-pagination" aria-label="색인 문제 페이지">
                <BodyAction disabled={busy || position === 0} onClick={() => setPosition(position - 1)}>
                  이전
                </BodyAction>
                <span className="meta" role="status">{position + 1}페이지 · 최대 5개</span>
                <BodyAction disabled={busy || !page.next_cursor} onClick={next}>다음</BodyAction>
              </nav>
            </>
          )}
        </div>
      )}
    </div>
  );
}

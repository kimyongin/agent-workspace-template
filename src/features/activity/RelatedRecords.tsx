import { Button } from "../../components/ui/button.tsx";
import { CollectionItem, CollectionList } from "../../components/Collection.tsx";

import { useSearchParams } from "react-router";
import { useDetailNavigate } from "../../lib/detail-exploration.tsx";
import { requestedPages } from "./list-state.ts";
import { type ListPage, MAX_RESTORE_PAGES } from "../collections/paged-list.ts";
import { usePagedList } from "../collections/usePagedList.ts";
import { type ReactNode, useContext, useEffect, useRef } from "react";
import { SurfaceContext } from "../../components/Modal.tsx";
import type { RecordResult } from "@contracts/record.ts";
import { recordDisplayText } from "@contracts/record-display.ts";
import { RelatedItem, RelatedSection } from "../../components/RelatedItems.tsx";
import { RelatedPreviewItem } from "../relations/RelatedPreviewItem.tsx";
import { Notice } from "../../components/Field.tsx";
import { api, query } from "../../lib/api.ts";

export function RelatedRecordItem({ record }: { record: Pick<RecordResult, "id" | "body"> }) {
  return (
    <>
      <RelatedPreviewItem to={`/records/${record.id}`} title={recordDisplayText(record.body)} />
    </>
  );
}

export function RelatedRecords(
  { taskId, revision, action, readOnly = false }: {
    taskId: string;
    revision: number;
    action?: ReactNode;
    readOnly?: boolean;
  },
) {
  // Refresh data without replacing the record creation trigger or its focus.
  return <TaskRecords taskId={taskId} revision={revision} action={action} readOnly={readOnly} />;
}
function TaskRecords(
  { taskId, revision, action, readOnly = false }: {
    taskId: string;
    revision: number;
    action?: ReactNode;
    readOnly?: boolean;
  },
) {
  const surface = useContext(SurfaceContext);
  const [params] = useSearchParams(), navigate = useDetailNavigate();
  const requested = requestedPages(new URLSearchParams({ pages: params.get("related_record_pages") ?? "1" }));
  const scope = `${taskId}|${revision}`;
  const initial = useRef({ scope, pages: requested });
  if (initial.current.scope !== scope) initial.current = { scope, pages: requested };
  const list = usePagedList<RecordResult, ListPage<RecordResult>>({
    scope,
    pages: initial.current.pages,
    restoreRetry: "resume",
    retainOnDecrease: true,
    load: (cursor, signal) => api("GET", `/records${query({ task_id: taskId, limit: 20, cursor })}`, undefined, signal),
  });
  const { page, busy, error } = list;
  // A background read must not navigate or interrupt a dirty management form.
  useEffect(() => {
    if (
      !page || busy || error || surface?.editor.current || params.has("edit") || params.has("action") ||
      params.has("occurrence") || Math.min(page.pages, MAX_RESTORE_PAGES) === requested
    ) return;
    const next = new URLSearchParams(params);
    next.set("related_record_pages", String(Math.min(page.pages, MAX_RESTORE_PAGES)));
    void navigate(`?${next}`);
  }, [page, busy, error, params, requested, navigate, surface]);
  return (
    <RelatedSection
      busy={busy || !page && !error}
      views={!readOnly}
      title="기록"
      count={page?.items.length}
      hasMore={!!page?.next_cursor}
      action={action}
    >
      {busy && <p className="text-sm text-muted-foreground" role="status">불러오는 중…</p>}
      {!!page?.items.length && (
        <CollectionList columns={["본문 대표 문구"]}>
          {page.items.map((record) => (
            <CollectionItem key={record.id}>
              {readOnly
                ? <RelatedItem title={recordDisplayText(record.body)} />
                : <RelatedRecordItem record={record} />}
            </CollectionItem>
          ))}
        </CollectionList>
      )}
      {!!error && <Notice kind="error">연결된 기록을 불러오지 못했습니다.</Notice>}
      {!readOnly && (page?.next_cursor || !!error) && (
        <Button
          variant="ghost"
          type="button"
          disabled={busy}
          onClick={() => error ? void list.retry() : list.more()}
        >
          {busy ? "불러오는 중…" : error ? "기록 다시 시도" : "기록 더 보기"}
        </Button>
      )}
    </RelatedSection>
  );
}

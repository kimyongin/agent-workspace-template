import { useApi } from "../../lib/api-context.tsx";
import { FieldGroup } from "@/components/ui/field";
import { BusinessCell, BusinessDisclosureCell, BusinessRow, BusinessTable } from "../../components/BusinessTable.tsx";
import { CollectionEmpty } from "../../components/CollectionEmpty.tsx";
import { Input } from "@/components/ui/input";
import { Button } from "../../components/ui/button.tsx";
import { surfaceFor } from "../../lib/surface-dom.ts";

import { useDeferredNavigation } from "../../lib/useDeferredNavigation.ts";
import { dataId } from "@contracts/data-id.ts";
import { tagCreate, tagLabels, type TagResult } from "@contracts/tag.ts";
import { useEffect, useRef, useState } from "react";
import { Navigate, useLocation, useParams, useSearchParams } from "../../lib/workspace-router.tsx";
import { Field, Notice } from "../../components/Field.tsx";
import { DeleteAction, type DeletionState } from "../../components/DeleteAction.tsx";
import { query } from "../../lib/api.ts";
import { ConfirmDialog, ModalShell } from "../../components/Modal.tsx";
import { ApiError } from "../../lib/api.ts";
import { useWriteAttempt, writeErrorMessage } from "../../lib/write-attempt.ts";
import { useDetailExploration, useDetailNavigate } from "../../lib/detail-exploration.tsx";
import { type TagScope, tagScopeLabels } from "./TagPicker.tsx";
import { createTagRead } from "./tag-read.ts";

type Page = { items: TagResult[]; next_cursor: string | null };
type Draft = { initial: TagResult | null; name: string };
export function TagsPage() {
  const { pathname } = useLocation(), route = useParams(), [params] = useSearchParams();
  const scope = route.scope === "entity" || pathname.endsWith("/entity")
    ? "entity"
    : route.scope === "task" || pathname.endsWith("/task")
    ? "task"
    : "record";
  const id = route.id ?? (route.scope && dataId.safeParse(route.scope).success ? route.scope : null);
  if (id) {
    const next = new URLSearchParams(params);
    if (next.get("edit") === "1") {
      next.set("edit", id);
      next.delete("view");
    } else if (!next.has("edit")) next.set("edit", id);
    return <Navigate to={`/tags/${scope}?${next}`} replace />;
  }
  return <ScopedTagsPage key={scope} scope={scope} />;
}
function ScopedTagsPage({ scope }: { scope: TagScope }) {
  return <TagManagement scope={scope} />;
}
export function TagManagement(
  { scope, mode = "route", onClose, onStateChange, readOnly = false, returnLabel = "닫기" }: {
    scope: TagScope;
    mode?: "route" | "inline" | "dialog";
    readOnly?: boolean;
    returnLabel?: string;
    onClose?: () => void;
    onStateChange?: (state: { dirty: boolean; busy: boolean; uncertain: boolean; error: boolean }) => void;
  },
) {
  const routed = mode === "route";
  const writable = useRef(!readOnly);
  writable.current = !readOnly;
  const api = useApi();
  const tagRead = createTagRead(api);
  const location = useLocation(), [params] = useSearchParams(), navigateAfterClose = useDeferredNavigation();
  const previous = useDetailExploration(), navigate = useDetailNavigate();
  const [closing, setClosing] = useState(false);
  const close = () => {
    setDraft(null);
    attempt.reset();
    setClosing(true);
  };
  const [page, setPage] = useState<Page | null>(null), [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null),
    [retry, setRetry] = useState(0),
    [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null), [deletingBusy, setDeletingBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null),
    [fieldError, setFieldError] = useState<string | undefined>();
  const [conflict, setConflict] = useState(false);
  const { attempt, uncertain, busy: writing } = useWriteAttempt();
  const [deletionState, setDeletionState] = useState<DeletionState>({ armed: false, busy: false, uncertain: false });
  const [deletions, setDeletions] = useState<Record<string, DeletionState>>({});
  const deletionDirty = Object.values(deletions).some((state) => state.armed || state.uncertain);
  const busy = writing || deletingBusy;
  useEffect(() => {
    if (closing && !busy) {
      setClosing(false);
      if (!routed) onClose?.();
      else if (previous) previous.back();
      else void navigate(scope === "entity" ? "/entities" : scope === "task" ? "/tasks" : "/records");
    }
  }, [closing, busy, previous, navigate, scope, routed, onClose]);
  const [pending, setPending] = useState<(() => void) | null>(null);
  useEffect(() => {
    setDeletionState({ armed: false, busy: false, uncertain: false });
  }, [draft?.initial?.id, !!draft]);
  const root = useRef<HTMLDivElement>(null);
  const pageCount = useRef(1),
    focusId = useRef<string | null>(null),
    input = useRef<HTMLInputElement>(null),
    saving = useRef(false);
  const readEpoch = useRef(0), readAbort = useRef<AbortController | null>(null);
  const invalidateReads = () => {
    readEpoch.current++;
    readAbort.current?.abort();
  };
  useEffect(() => () => {
    readEpoch.current++;
    readAbort.current?.abort();
  }, []);
  const dirty = !closing && (deletionDirty || !!draft && (draft.name !== (draft.initial?.name ?? "") || uncertain));
  const resultsUncertain = uncertain || Object.values(deletions).some((state) => state.uncertain);
  const failed = !!(error || failure || fieldError);
  useEffect(() => onStateChange?.({ dirty, busy, uncertain: resultsUncertain, error: failed }), [
    dirty,
    busy,
    resultsUncertain,
    failed,
    onStateChange,
  ]);
  useEffect(() => {
    readAbort.current?.abort();
    const controller = new AbortController();
    readAbort.current = controller;
    const epoch = ++readEpoch.current;
    const current = () => !controller.signal.aborted && epoch === readEpoch.current;
    setLoading(true);
    setError(null);
    (async () => {
      let loaded: Page = { items: [], next_cursor: null };
      for (let i = 0; i < pageCount.current; i++) {
        const next = await api<Page>(
          "GET",
          `/tags?scope=${scope}${loaded.next_cursor ? `&cursor=${encodeURIComponent(loaded.next_cursor)}` : ""}`,
          undefined,
          controller.signal,
        );
        loaded = { items: [...loaded.items, ...next.items], next_cursor: next.next_cursor };
        if (!next.next_cursor) break;
      }
      if (current()) setPage(loaded);
    })().catch(() => {
      if (current()) setError("태그 목록을 불러오지 못했습니다. 기존 목록은 유지합니다.");
    })
      .finally(() => {
        if (current()) setLoading(false);
      });
    return () => controller.abort();
  }, [retry, scope]);
  useEffect(() => {
    if (!focusId.current || loading) return;
    // Restore focus after the confirmation stage has revealed the refreshed management list.
    const frame = requestAnimationFrame(() => {
      (document.getElementById(`tag-${focusId.current}`) ?? surfaceFor(root.current)?.heading ??
        document.getElementById("tag-heading"))?.focus();
      focusId.current = null;
    });
    return () => cancelAnimationFrame(frame);
  }, [page, loading]);
  const change = (action: () => void) => {
    if (busy) return;
    if (dirty) setPending(() => action);
    else action();
  };
  const select = (tag: TagResult) =>
    change(() => {
      setDraft({ initial: tag, name: tag.name });
      setFailure(null);
      setNotice(null);
      setFieldError(undefined);
      attempt.startNewIntent();
      setConflict(false);
      const p = new URLSearchParams(params);
      p.delete("view");
      p.delete("create");
      p.delete("edit_from");
      p.set("edit", tag.id);
      if (routed) navigateAfterClose(`?${p}`, true);
      requestAnimationFrame(() => input.current?.focus());
    });
  const dismiss = () => {
    const p = new URLSearchParams(params);
    for (const key of ["view", "edit", "create", "edit_from"]) p.delete(key);
    if (routed) navigateAfterClose(`?${p}`, true);
  };
  useEffect(() => {
    if (!routed) return;
    const controller = new AbortController();
    const selected = params.get("edit") ?? params.get("view");
    if (params.get("create") === "1") {
      if (!draft) {
        attempt.startNewIntent();
        setDraft({ initial: null, name: "" });
      }
      return;
    }
    if (selected && draft?.initial?.id !== selected) {
      tagRead.find(scope, selected, controller.signal).then((tag) => {
        if (!controller.signal.aborted) {
          if (tag) {
            attempt.startNewIntent();
            setDraft({ initial: tag, name: tag.name });
          } else setFailure("태그를 찾을 수 없습니다.");
        }
      }).catch(() => {
        if (!controller.signal.aborted) setFailure("태그를 불러오지 못했습니다.");
      });
    }
    return () => controller.abort();
  }, [location.key, routed]);
  const cancel = () => {
    if (attempt.snapshot().uncertain) {
      setNotice("이전 저장 결과를 확인하지 못했습니다. 새 작업 전에 갱신된 태그 목록을 확인하세요.");
      setRetry((n) => n + 1);
    }
    const id = draft?.initial?.id ?? "heading";
    setDraft(null);
    attempt.reset();
    setFailure(null);
    setFieldError(undefined);
    setConflict(false);
    if (conflict) {
      focusId.current = id;
      setRetry((n) => n + 1);
    } else {requestAnimationFrame(() =>
        (document.getElementById(`tag-${id}`) ?? surfaceFor(root.current)?.heading ??
          document.getElementById("tag-heading"))?.focus()
      );}
    dismiss();
  };
  const save = async () => {
    if (!writable.current || attempt.snapshot().busy || deletingBusy || conflict || deletionState.armed) return;
    const currentDraft = draft ?? { initial: null, name: "" };
    const parsed = tagCreate.safeParse({ name: currentDraft.name });
    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message);
      input.current?.focus();
      return;
    }
    setFailure(null);
    setFieldError(undefined);
    try {
      await attempt.run(async () => {
        const saved = await api<TagResult>(
          currentDraft.initial ? "PATCH" : "POST",
          currentDraft.initial ? `/tags/${currentDraft.initial.id}` : "/tags",
          currentDraft.initial
            ? { name: parsed.data.name, expected_version: currentDraft.initial.version }
            : { ...parsed.data, scope },
          undefined,
          attempt.requestKey(),
        );
        invalidateReads();
        setPage((p) =>
          p
            ? {
              ...p,
              items: p.items.some((t) => t.id === saved.id)
                ? p.items.map((t) => t.id === saved.id ? saved : t)
                : [saved, ...p.items],
            }
            : { items: [saved], next_cursor: null }
        );
        setNotice("태그를 저장했습니다.");
        focusId.current = saved.id;
        setDraft(null);
        attempt.reset();
        dismiss();
        setRetry((n) => n + 1);
      });
    } catch (e) {
      if (e instanceof ApiError && e.code === "conflict") {
        let versionConflict = false, readFailure = false;
        if (currentDraft.initial) {
          try {
            const current = await tagRead.find(scope, currentDraft.initial.id);
            versionConflict = !current || current.version !== currentDraft.initial.version;
          } catch {
            readFailure = true;
          }
        }
        setConflict(versionConflict);
        setFailure(
          versionConflict
            ? "다른 변경이 저장되었습니다. 초안을 유지합니다. 취소 후 최신 태그를 다시 선택하세요."
            : readFailure
            ? `${e.message} 최신 상태를 조회하지 못했습니다. 초안을 유지합니다.`
            : e.message,
        );
        if (!versionConflict && !readFailure) setFieldError(e.message);
      } else setFailure(writeErrorMessage(e));
      if (e instanceof ApiError && e.fields.some((f) => f.path === "name")) {
        setFieldError(e.fields.find((f) => f.path === "name")?.message);
      }
    }
  };
  const deleteTag = async (target: TagResult, reason: string, tags: string[] | undefined, requestKey: () => string) => {
    if (!writable.current) throw new ApiError(403, "forbidden", "태그를 변경하려면 설정 편집 권한이 필요합니다.");
    if (saving.current) return;
    saving.current = true;
    setDeletingBusy(true);
    setFailure(null);
    try {
      await api(
        "DELETE",
        `/tags/${target.id}${
          query({
            expected_version: target.version,
            change_note: reason,
            change_tag_ids: tags?.length ? tags.join(",") : undefined,
          })
        }`,
        undefined,
        undefined,
        requestKey(),
      );
      invalidateReads();
      const at = page?.items.findIndex((t) => t.id === target.id) ?? -1;
      focusId.current = page?.items[at + 1]?.id ?? page?.items[at - 1]?.id ?? "heading";
      setDeletions((current) => {
        const next = { ...current };
        delete next[target.id];
        return next;
      });
      setPage((p) => p && ({ ...p, items: p.items.filter((t) => t.id !== target.id) }));
      setNotice("태그를 삭제했습니다.");
      if (draft?.initial?.id === target.id) {
        setDraft(null);
        attempt.reset();
        dismiss();
      }
      setRetry((n) => n + 1);
    } catch (e) {
      focusId.current = target.id;
      setNotice(null);
      setFailure(writeErrorMessage(e));
      throw e;
    } finally {
      setDeletingBusy(false);
      saving.current = false;
    }
  };
  const reportDeletion = (id: string, state: DeletionState) =>
    setDeletions((current) => {
      const before = current[id];
      return before && before.armed === state.armed && before.busy === state.busy &&
          before.uncertain === state.uncertain
        ? current
        : { ...current, [id]: state };
    });
  const deleteAction = (target: TagResult, editor = false) => (
    <DeleteAction
      target={target.name}
      key={target.id}
      excludeTag={target.id}
      disabled={readOnly || busy || (deletionDirty && !deletions[target.id]?.armed && !deletions[target.id]?.uncertain) ||
        (editor && (uncertain || conflict))}
      label={editor ? "삭제" : `${target.name} 삭제`}
      message="태그와 연결을 제거합니다. 원문은 보존합니다."
      onStateChange={(state) => {
        reportDeletion(target.id, state);
        if (editor) {
          setDeletionState((current) =>
            current.armed === state.armed && current.busy === state.busy && current.uncertain === state.uncertain
              ? current
              : state
          );
        }
      }}
      onConfirm={(reason, tags, requestKey) => deleteTag(target, reason, tags, requestKey)}
    />
  );
  const editor = (initial: TagResult | null) => (
    <form
      className="flex min-w-0 flex-col gap-4"
      data-mode={initial ? "edit" : "create"}
      aria-label={initial ? "태그 이름 변경" : "태그 추가"}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <FieldGroup>
        <Field label={tagLabels.name} required error={fieldError}>
          {(p) => (
            <Input
              {...p}
              ref={input}
              placeholder="태그 이름"
              value={draft?.name ?? ""}
              readOnly={readOnly || busy || uncertain || deletionState.armed}
              onChange={(e) => setDraft({ initial, name: e.target.value })}
            />
          )}
        </Field>
      </FieldGroup>
      <div className="flex flex-wrap items-center gap-2">
        {initial && deleteAction(initial, true)}
        {draft && <Button type="button" variant="outline" disabled={busy} onClick={() => change(cancel)}>취소</Button>}
        <Button type="submit" variant="default" disabled={readOnly || busy || conflict || deletionState.armed}>
          {writing ? "저장 중…" : uncertain ? "같은 내용 다시 시도" : initial ? "저장" : "추가"}
        </Button>
      </div>
      {failure && <Notice kind="error">{failure}</Notice>}
    </form>
  );
  const body = (
    <>
      <div ref={root} className="@container flex min-w-0 flex-col gap-4">
        {!draft?.initial && (!readOnly || draft) && editor(null)}
        {notice && <Notice>{notice}</Notice>}
        {error && (
          <>
            <Notice kind="error">{error}</Notice>
            <Button type="button" variant="outline" disabled={loading} onClick={() => setRetry((n) => n + 1)}>
              목록 다시 시도
            </Button>
          </>
        )}
        {loading && <p className="text-sm text-muted-foreground" role="status">불러오는 중…</p>}
        {page?.items.length === 0 && !draft?.initial && !loading && !error && (
          <CollectionEmpty title="아직 태그가 없습니다." description={readOnly ? "현재 범위에 등록된 태그가 없습니다." : "태그 이름을 입력하고 추가하세요."} />
        )}
        {!!(page?.items.length || draft?.initial) && (<BusinessTable disclosureColumn={false} label={`${tagScopeLabels[scope]} 태그 목록`} columns={readOnly ? ["태그 이름"] : ["태그 이름", "작업"]}>
          {(draft?.initial && !page?.items.some((t) => t.id === draft.initial?.id)
            ? [draft.initial, ...(page?.items ?? [])]
            : page?.items ?? []).map((tag) => (
              <BusinessRow key={tag.id}>
                <BusinessDisclosureCell />
                <BusinessCell index={0}>
                  {draft?.initial?.id === tag.id ? editor(tag) : (
                    <span className="font-medium wrap-anywhere">{tag.name}</span>
                  )}
                </BusinessCell>
                <BusinessCell index={1} hidden={readOnly} className={readOnly ? "hidden" : undefined}>{draft?.initial?.id !== tag.id && (
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <Button
                      variant="ghost"
                      type="button"
                      id={`tag-${tag.id}`}
                      disabled={busy}
                      aria-label={`${tag.name} 이름 변경`}
                      onClick={() => select(tag)}
                    >
                      이름 변경
                    </Button>
                    {deleteAction(tag)}
                  </div>
                )}</BusinessCell>
              </BusinessRow>
            ))}
        </BusinessTable>)}
        {page?.next_cursor && (
          <Button
            variant="ghost"
            type="button"
            disabled={loading || busy}
            onClick={async () => {
              const epoch = readEpoch.current, controller = new AbortController();
              readAbort.current = controller;
              const current = () => !controller.signal.aborted && epoch === readEpoch.current;
              setLoading(true);
              setError(null);
              try {
                const next = await api<Page>(
                  "GET",
                  `/tags?scope=${scope}&cursor=${encodeURIComponent(page.next_cursor!)}`,
                  undefined,
                  controller.signal,
                );
                if (!current()) return;
                setPage((p) =>
                  p && ({
                    items: [
                      ...p.items,
                      ...next.items.filter((t) => !p.items.some((old) => old.id === t.id)),
                    ],
                    next_cursor: next.next_cursor,
                  })
                );
                pageCount.current++;
              } catch {
                if (current()) setError("다음 태그를 불러오지 못했습니다.");
              } finally {
                if (current()) setLoading(false);
              }
            }}
          >
            더 보기
          </Button>
        )}
        <ConfirmDialog
          open={!!pending}
          busy={busy}
          title="변경을 버릴까요?"
          message="저장하지 않은 내용이 사라집니다."
          confirmLabel="변경 버리기"
          onCancel={() => setPending(null)}
          onConfirm={() => {
            const action = pending;
            setPending(null);
            action?.();
          }}
        />
      </div>
    </>
  );
  if (mode === "inline") return <section aria-label={`${tagScopeLabels[scope]} 태그 관리`}>{body}</section>;
  return (
    <ModalShell
      open
      ready={!loading}
      scrollHeaderWithBody={mode === "dialog"}
      title={`${tagScopeLabels[scope]} 태그 관리`}
      description={mode === "dialog"
        ? "태그 사전의 변경은 따로 저장됩니다. 돌아간 뒤 태그를 선택하고 원래 설정을 저장하세요."
        : "태그를 추가하거나 이름을 바꾸고, 사용하지 않는 태그를 정리합니다."}
      headingLevel={routed ? 1 : 2}
      previous={routed ? previous : null}
      dirty={dirty}
      busy={busy || mode === "dialog" && resultsUncertain}
      onClose={close}
      footer={mode === "dialog" ? requestClose => (
        <Button variant="outline" type="button" className="h-auto min-h-11 max-w-full whitespace-normal" disabled={busy || resultsUncertain} onClick={requestClose}>{returnLabel}</Button>
      ) : undefined}
      onRouteDiscard={() => {
        setDraft(null);
        setDeletions({});
        attempt.reset();
      }}
    >
      {body}
    </ModalShell>
  );
}

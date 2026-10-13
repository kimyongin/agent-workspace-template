import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { EntityIdentitySettings } from "./EntityIdentitySettings.tsx";
import { RecordTemplateSettings } from "./RecordTemplateSettings.tsx";
import type { MaterialTemplateResource } from "./material-template-drafts.ts";
import { TagManagement } from "../tags/TagsPage.tsx";
import { ConfirmDialog } from "../../components/Modal.tsx";
import { DetailLink } from "../../lib/detail-exploration.tsx";
import { api } from "../../lib/api.ts";
import type { EntitySummary } from "@contracts/entity.ts";

export function MaterialCommonSettings({
  open,
  templates,
  onStateChange,
  onClose,
}: {
  open: boolean;
  templates: MaterialTemplateResource;
  onStateChange: (state: { dirty: boolean; busy: boolean }) => void;
  onClose: () => void;
}) {
  const [identity, setIdentity] = useState({ dirty: false, busy: false }),
    [record, setRecord] = useState({ dirty: false, busy: false }),
    [tags, setTags] = useState({ dirty: false, busy: false });
  const [scope, setScope] = useState<"entity" | "record" | null>(null),
    [confirm, setConfirm] = useState(false);
  const busy = identity.busy || record.busy || tags.busy,
    dirty = identity.dirty || record.dirty || tags.dirty;
  const reportTags = useCallback(
    (state: { dirty: boolean; busy: boolean }) => setTags(state),
    [],
  );
  useEffect(() => onStateChange({ dirty, busy }), [dirty, busy, onStateChange]);
  const close = () => {
    if (busy) return;
    if (tags.dirty) setConfirm(true);
    else onClose();
  };
  const ref = useRef<HTMLDivElement>(null),
    tagLaunch = useRef<HTMLButtonElement | null>(null);
  useLayoutEffect(() => {
    if (!scope) tagLaunch.current?.focus({ preventScroll: true });
  }, [scope]);
  useEffect(() => {
    if (!open) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !document.querySelector("dialog[open]")) {
        event.preventDefault();
        close();
      }
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [open, busy, tags.dirty]);
  return (
    <div
      ref={ref}
      hidden={!open}
      className="material-common-settings"
      role="region"
      aria-label="자료 공통 설정"
    >
      <div className="actions">
        <h2>자료 공통 설정</h2>
        <button className="btn" disabled={busy} onClick={close}>
          공통 설정 닫기
        </button>
      </div>
      <div hidden={!!scope}>
        <EntityIdentitySettings onStateChange={setIdentity} />
        <RecordTemplateSettings
          materialResource={templates}
          common
          onStateChange={setRecord}
        />
        <div className="actions">
          <button
            className="btn"
            disabled={busy}
            onClick={(event) => {
              tagLaunch.current = event.currentTarget;
              setScope("entity");
            }}
          >
            자료 태그 관리
          </button>
          <button
            className="btn"
            disabled={busy}
            onClick={(event) => {
              tagLaunch.current = event.currentTarget;
              setScope("record");
            }}
          >
            기록 태그 관리
          </button>
        </div>
        <MaterialEntityLookup enabled={open} />
      </div>
      {scope && (
        <TagManagement
          key={scope}
          scope={scope}
          inline
          onStateChange={reportTags}
          onClose={() => {
            setScope(null);
            setTags({ dirty: false, busy: false });
            requestAnimationFrame(() => tagLaunch.current?.focus({ preventScroll: true }));
          }}
        />
      )}
      <ConfirmDialog
        open={confirm}
        title="변경을 버릴까요?"
        confirmLabel="변경 버리기"
        message="태그 관리의 저장하지 않은 입력이 사라집니다. 공통 설정 초안은 유지합니다."
        onCancel={() => setConfirm(false)}
        onConfirm={() => {
          setConfirm(false);
          setScope(null);
          setTags({ dirty: false, busy: false });
          onClose();
        }}
      />
    </div>
  );
}
function MaterialEntityLookup({ enabled }: { enabled: boolean }) {
  type Page = { items: EntitySummary[]; next_cursor: string | null };
  const [page, setPage] = useState<Page | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const read = async (cursor?: string) => {
    if (pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setLoading(true);
    setError("");
    try {
      const value = await api<Page>(
        "GET",
        `/entities${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
        undefined,
        controller.signal,
      );
      if (!controller.signal.aborted) {
        setPage((previous) => ({
          items: cursor && previous
            ? [
              ...previous.items,
              ...value.items.filter((item) => !previous.items.some((saved) => saved.id === item.id)),
            ]
            : value.items,
          next_cursor: value.next_cursor ?? null,
        }));
      }
    } catch {
      if (!controller.signal.aborted) setError("자료를 읽지 못했습니다. 읽어온 목록은 유지합니다.");
    } finally {
      if (!controller.signal.aborted && pending.current === controller) {
        pending.current = null;
        setLoading(false);
      }
    }
  };
  useEffect(() => {
    if (enabled && !page && !pending.current) void read();
  }, [enabled]);
  useEffect(() => () => pending.current?.abort(), []);
  return (
    <section aria-label="자료 확인">
      <h3>자료 확인</h3>
      {loading && <p role="status">자료를 읽는 중…</p>}
      {error && (
        <>
          <p role="alert">{error}</p>
          <button className="btn" disabled={loading} onClick={() => void read(page?.next_cursor ?? undefined)}>
            자료 다시 시도
          </button>
        </>
      )}
      {page && (
        <ul>
          {page.items.map((item) => (
            <li key={item.id}>
              <DetailLink to={`/entities/${item.id}`}>{item.title} 자료 확인</DetailLink>
            </li>
          ))}
        </ul>
      )}
      {page && !page.items.length && !loading && !error && <p className="secondary">확인할 자료가 없습니다.</p>}
      {page?.next_cursor && !error && (
        <button
          className="btn"
          disabled={loading}
          onClick={() => void read(page.next_cursor!)}
        >
          자료 더 읽기
        </button>
      )}
    </section>
  );
}

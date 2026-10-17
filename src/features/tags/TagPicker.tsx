import type { TagResult } from "@contracts/tag.ts";
import { createContext, type ReactNode, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation } from "react-router";
import { WorkspaceContext } from "../details/workspace-context.ts";
import { api } from "../../lib/api.ts";
import { Notice } from "../../components/Field.tsx";
import { TagSelection } from "./TagSelection.tsx";
import { createTagRead } from "./tag-read.ts";
const tagRead = createTagRead(api);

export type TagScope = TagResult["scope"];
type TagDictionary = {
  scope: TagScope | "mixed";
  tags: TagResult[] | null;
  failed: boolean;
  pending: boolean;
  retry: () => void;
};
export const tagScopeLabels: Record<TagScope, string> = { entity: "자료", task: "할 일", record: "기록" };
export function useTagDictionary(enabled = true, preserveListLayout = false, scope: TagScope = "record") {
  const location = useLocation(), workspace = useContext(WorkspaceContext);
  const revision = workspace?.revision, navigationKey = workspace?.navigationKey;
  const [read, setRead] = useState<{ scope: TagScope; tags: TagResult[] | null; failed: boolean; pending: boolean }>({
    scope,
    tags: null,
    failed: false,
    pending: true,
  });
  const [retry, setRetry] = useState(0);
  const tags = read.scope === scope ? read.tags : null,
    failed = read.scope === scope && read.failed,
    pending = read.scope !== scope || read.pending;
  const position = useRef<{ target: HTMLElement; y: number; focus: boolean } | null>(null);
  useLayoutEffect(() => {
    const saved = position.current;
    if (!saved || !saved.target.isConnected) return;
    window.scrollBy(0, saved.target.getBoundingClientRect().top - saved.y);
    if (saved.focus) saved.target.focus({ preventScroll: true });
    if (tags) position.current = null;
  }, [tags, failed]);
  const capturePosition = () => {
    position.current = null;
    if (preserveListLayout) {
      const active = document.activeElement as HTMLElement | null;
      const row = active?.closest(".list-item");
      const target = (row?.querySelector(".item-title[id]") ??
        Array.from(document.querySelectorAll<HTMLElement>(".list-item .item-title[id]")).find((el) => {
          const r = el.getBoundingClientRect();
          return r.bottom > 0 && r.top < innerHeight;
        })) as HTMLElement | undefined;
      if (target) position.current = { target, y: target.getBoundingClientRect().top, focus: !!row };
    }
  };
  const retryLookup = () => {
    capturePosition();
    setRetry((n) => n + 1);
  };
  useEffect(() => {
    if (!enabled) return;
    const refresh = () => {
      if (document.visibilityState === "visible") setRetry((n) => n + 1);
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("workspace:tags-changed", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("workspace:tags-changed", refresh);
    };
  }, [enabled]);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    setRead((previous) => ({
      scope,
      tags: previous.scope === scope ? previous.tags : null,
      failed: previous.scope === scope && previous.failed,
      pending: true,
    }));
    tagRead.all(scope, controller.signal).then((all) => {
      if (!controller.signal.aborted) {
        capturePosition();
        setRead({ scope, tags: all, failed: false, pending: false });
      }
    }).catch(() => {
      if (!controller.signal.aborted) setRead((previous) => ({ ...previous, failed: true, pending: false }));
    });
    return () => controller.abort();
  }, [retry, enabled, scope, location.pathname, location.search, location.hash, revision, navigationKey]);
  return { scope, tags, failed, pending, retry: retryLookup };
}
export function TagPicker(
  { value, onChange, error, scope = "record", label, excludeId }: {
    value: string[];
    onChange: (ids: string[]) => void;
    error?: string;
    scope?: TagScope;
    label?: string;
    excludeId?: string;
  },
) {
  const { tags, failed, retry } = useTagDictionary(true, false, scope);
  return (
    <TagSelection
      label={label ?? `${tagScopeLabels[scope]} 태그`}
      tags={tags}
      value={value}
      onChange={onChange}
      error={error}
      excludeId={excludeId}
      status={failed
        ? (
          <>
            <Notice kind="error">태그를 불러오지 못했습니다. 기존 선택은 유지합니다.</Notice>
            <button type="button" className="btn" onClick={retry}>태그 다시 시도</button>
          </>
        )
        : !tags
        ? <p className="secondary" role="status">태그를 불러오는 중…</p>
        : null}
    />
  );
}
export function TagFilter(
  { value, onChange, dictionary, showFailure = true }: {
    value: string;
    onChange: (id: string) => void;
    dictionary?: TagDictionary;
    showFailure?: boolean;
  },
) {
  const local = useTagDictionary(!dictionary);
  const { tags, failed, retry } = dictionary ?? local;
  return (
    <TagSelection
      label="태그 필터"
      tags={tags}
      value={value ? [value] : []}
      onChange={(ids) => onChange(ids[0] ?? "")}
      maxSelected={1}
      status={showFailure && failed
        ? (
          <>
            <Notice kind="error">태그 필터를 불러오지 못했습니다.</Notice>
            <button type="button" className="btn" onClick={retry}>태그 다시 시도</button>
          </>
        )
        : !tags
        ? <p className="secondary" role="status">태그를 불러오는 중…</p>
        : undefined}
    />
  );
}
export function TagDictionaryStatus({ dictionary }: { dictionary: TagDictionary }) {
  return dictionary.failed
    ? (
      <>
        <Notice kind="error">태그 사전을 불러오지 못했습니다. 조건과 기존 행은 유지합니다.</Notice>
        <button type="button" className="btn" onClick={dictionary.retry}>태그 다시 시도</button>
      </>
    )
    : null;
}
const TagReadContext = createContext<TagDictionary | null>(null);
/** One lookup per visible list, with scope-local cancellation rather than a cross-owner cache. */
export function TagReadProvider(
  { children, enabled = true, dictionary }: { children: ReactNode; enabled?: boolean; dictionary?: TagDictionary },
) {
  const local = useTagDictionary(enabled && !dictionary);
  const state = dictionary ?? local;
  // Unknown names can wrap to different heights. Reveal the initial tagged rows only after the lookup settles.
  if (enabled && !state.tags && !state.failed) {
    return <p className="secondary" role="status">태그 이름을 불러오는 중…</p>;
  }
  return <TagReadContext.Provider value={state}>{children}</TagReadContext.Provider>;
}
export function TagNames(
  { ids, compact = false, scope = "record", onReadyChange, onRemove }: {
    ids: string[];
    compact?: boolean;
    scope?: TagScope;
    onReadyChange?: (ready: boolean) => void;
    onRemove?: (id: string) => void;
  },
) {
  const context = useContext(TagReadContext);
  const shared = context?.scope === scope || context?.scope === "mixed" ? context : null;
  const local = useTagDictionary(ids.length > 0 && !shared, false, scope);
  const { tags, failed, pending, retry } = shared ?? local;
  useLayoutEffect(() => onReadyChange?.(!ids.length || !!tags || failed), [ids.length, tags, failed, onReadyChange]);
  if (!ids.length) return null;
  // The shared filter owns retry; repeating an error card/button in every row destabilizes reading geometry.
  if (compact && failed && shared) {
    return (
      <div className="chips" role="status">
        <span className="meta tag-read">태그 이름 조회 실패</span>
      </div>
    );
  }
  return (
    <div className="read-context">
      {!compact && <h2 className="section-title">태그</h2>}
      {failed
        ? (
          <>
            <Notice kind="error">태그 이름을 불러오지 못했습니다.</Notice>
            <button className="btn" onClick={retry}>태그 다시 시도</button>
          </>
        )
        : !tags
        ? (compact
          ? (
            <div className="chips" role="status">
              {ids.map((id) => <span className="meta tag-read" key={id}>태그를 불러오는 중…</span>)}
            </div>
          )
          : <p className="secondary" role="status">태그를 불러오는 중…</p>)
        : (
          <div className="chips" aria-label="태그">
            {ids.map((id) => (
              <span className="meta tag-read" key={id}>
                <span>{tags.find((t) => t.id === id)?.name ?? (pending ? "태그 확인 중…" : "태그 확인 필요")}</span>
                {onRemove && <button type="button" className="body-action" aria-label={`${tags.find(t => t.id === id)?.name ?? "이름 확인이 필요한 태그"} 연결 해제`} onClick={() => onRemove(id)}>해제</button>}
              </span>
            ))}
          </div>
        )}
    </div>
  );
}

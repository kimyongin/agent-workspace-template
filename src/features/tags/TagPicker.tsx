import { useApi, useRequestScope, sameRequestScope } from "../../lib/api-context.tsx";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { scrollOwner, shiftScroll, surfaceFor } from "../../lib/surface-dom.ts";
import type { TagResult } from "@contracts/tag.ts";
import { createContext, type ReactNode, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation } from "../../lib/workspace-router.tsx";
import { WorkspaceContext } from "../details/workspace-context.ts";

import { Notice } from "../../components/Field.tsx";
import { TagSelection } from "./TagSelection.tsx";
import { createTagRead, type TagReadPurpose } from "./tag-read.ts";


export type TagScope = TagResult["scope"];
type TagDictionary = {
  scope: TagScope | "mixed";
  tags: TagResult[] | null;
  failed: boolean;
  pending: boolean;
  retry: () => void;
};
export const tagScopeLabels: Record<TagScope, string> = { entity: "자료", task: "할 일", record: "기록" };
export function useTagDictionary(enabled = true, preserveListLayout = false, scope: TagScope = "record", purpose?: TagReadPurpose) {
  const api = useApi();
  const requestScope = useRequestScope();
  const tagRead = createTagRead(api, purpose);
  const location = useLocation(), workspace = useContext(WorkspaceContext);
  const revision = workspace?.revision, navigationKey = workspace?.navigationKey;
  const [read, setRead] = useState<{ scope: TagScope; purpose?: TagReadPurpose; tags: TagResult[] | null; failed: boolean; pending: boolean }>({
    scope,
    purpose,
    tags: null,
    failed: false,
    pending: true,
  });
  const [retry, setRetry] = useState(0);
  const tags = read.scope === scope && read.purpose === purpose ? read.tags : null,
    failed = read.scope === scope && read.purpose === purpose && read.failed,
    pending = read.scope !== scope || read.purpose !== purpose || read.pending;
  const position = useRef<{ target: HTMLElement; y: number; focus: boolean } | null>(null);
  useLayoutEffect(() => {
    const saved = position.current;
    if (!saved || !saved.target.isConnected) return;
    shiftScroll(saved.target, saved.target.getBoundingClientRect().top - saved.y);
    if (saved.focus) saved.target.focus({ preventScroll: true });
    if (tags) position.current = null;
  }, [tags, failed]);
  const capturePosition = () => {
    position.current = null;
    if (preserveListLayout) {
      const active = document.activeElement as HTMLElement | null;
      const row = active?.closest<HTMLElement>("[data-list-row]");
      const owner = scrollOwner(active);
      const bounds = owner?.getBoundingClientRect();
      const target = (row?.querySelector<HTMLElement>("[data-list-anchor][id]") ??
        Array.from((owner ?? document).querySelectorAll<HTMLElement>("[data-list-anchor][id]")).find((el) => {
          const r = el.getBoundingClientRect();
          return !surfaceFor(el) && r.bottom > (bounds?.top ?? 0) && r.top < (bounds?.bottom ?? innerHeight);
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
    const refresh = (event: Event) => {
      if (event.type === "workspace:tags-changed" && !sameRequestScope(event, requestScope)) return;
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
      purpose,
      tags: previous.scope === scope && previous.purpose === purpose ? previous.tags : null,
      failed: previous.scope === scope && previous.purpose === purpose && previous.failed,
      pending: true,
    }));
    tagRead.all(scope, controller.signal).then((all) => {
      if (!controller.signal.aborted) {
        capturePosition();
        setRead({ scope, purpose, tags: all, failed: false, pending: false });
      }
    }).catch(() => {
      if (!controller.signal.aborted) setRead((previous) => ({ ...previous, failed: true, pending: false }));
    });
    return () => controller.abort();
  }, [retry, enabled, scope, purpose, location.pathname, location.search, location.hash, revision, navigationKey]);
  return { scope, tags, failed, pending, retry: retryLookup };
}
export function TagPicker(
  { value, onChange, error, scope = "record", label, excludeId, disabled = false, purpose }: {
    value: string[];
    onChange: (ids: string[]) => void;
    error?: string;
    scope?: TagScope;
    label?: string;
    excludeId?: string;
    disabled?: boolean;
    purpose?: TagReadPurpose;
  },
) {
  const { tags, failed, retry } = useTagDictionary(true, false, scope, purpose);
  return (
    <TagSelection
      label={label ?? `${tagScopeLabels[scope]} 태그`}
      tags={tags}
      value={value}
      onChange={onChange}
      error={error}
      excludeId={excludeId}
      disabled={disabled}
      status={failed
        ? (
          <>
            <Notice kind="error">태그를 불러오지 못했습니다. 기존 선택은 유지합니다.</Notice>
            <Button variant="outline" type="button" disabled={disabled} onClick={retry}>태그 다시 시도</Button>
          </>
        )
        : !tags
        ? <p className="text-sm text-muted-foreground" role="status">태그를 불러오는 중…</p>
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
            <Button variant="outline" type="button" onClick={retry}>태그 다시 시도</Button>
          </>
        )
        : !tags
        ? <p className="text-sm text-muted-foreground" role="status">태그를 불러오는 중…</p>
        : undefined}
    />
  );
}
export function TagDictionaryStatus({ dictionary }: { dictionary: TagDictionary }) {
  return dictionary.failed
    ? (
      <>
        <Notice kind="error">태그 사전을 불러오지 못했습니다. 조건과 기존 행은 유지합니다.</Notice>
        <Button variant="outline" type="button" onClick={dictionary.retry}>태그 다시 시도</Button>
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
    return <p className="text-sm text-muted-foreground" role="status">태그 이름을 불러오는 중…</p>;
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
      <div className="flex min-w-0 flex-wrap gap-2" role="status">
        <Badge variant="secondary" className="h-auto max-w-full gap-2 whitespace-normal">태그 이름 조회 실패</Badge>
      </div>
    );
  }
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {!compact && <h2 className="text-sm font-medium">태그</h2>}
      {failed
        ? (
          <>
            <Notice kind="error">태그 이름을 불러오지 못했습니다.</Notice>
            <Button variant="outline" type="button" onClick={retry}>태그 다시 시도</Button>
          </>
        )
        : !tags
        ? (compact
          ? (
            <div className="flex min-w-0 flex-wrap gap-2" role="status">
              {ids.map((id) => (
                <Badge variant="secondary" className="h-auto max-w-full gap-2 whitespace-normal" key={id}>
                  태그를 불러오는 중…
                </Badge>
              ))}
            </div>
          )
          : <p className="text-sm text-muted-foreground" role="status">태그를 불러오는 중…</p>)
        : (
          <div className="flex min-w-0 flex-wrap gap-2" aria-label="태그">
            {ids.map((id) => (
              <Badge variant="secondary" className="h-auto max-w-full gap-2 whitespace-normal" key={id}>
                <span className="min-w-0 wrap-anywhere">
                  {tags.find((t) => t.id === id)?.name ?? (pending ? "태그 확인 중…" : "태그 확인 필요")}
                </span>
                {onRemove && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`${tags.find((t) => t.id === id)?.name ?? "이름 확인이 필요한 태그"} 연결 해제`}
                    onClick={() => onRemove(id)}
                  >
                    해제
                  </Button>
                )}
              </Badge>
            ))}
          </div>
        )}
    </div>
  );
}

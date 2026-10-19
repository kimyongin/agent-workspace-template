import { Button } from "../../components/ui/button.tsx";
import { EyeIcon } from "lucide-react";
import { shiftScroll } from "../../lib/surface-dom.ts";
import {
  type ComponentProps,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Link, type LinkProps } from "../../lib/workspace-router.tsx";
import { RelatedItem, useRelatedExpansion } from "../../components/RelatedItems.tsx";

import { useExpansionRegistration } from "../../components/item-expansion.tsx";
import { Notice } from "../../components/Field.tsx";
import { SurfaceContext } from "../../components/Modal.tsx";
import { DetailLink } from "../../lib/detail-exploration.tsx";
import { useRelatedRead } from "./useRelatedRead.ts";
import type { RelatedRead } from "./related-read.ts";
import { ApiError } from "../../lib/api.ts";

import { type Preview, PreviewContents, previewKind } from "./PreviewContents.tsx";
import { ListPreviewReadiness } from "./preview-readiness.ts";

/** Current content only, never another relationship graph or a write during disclosure. */
export function RelatedPreviewItem(
  { list, fallback, resource, ...props }: ComponentProps<typeof RelatedItem> & {
    list?: { link: () => LinkProps; metadata?: ReactNode };
    fallback?: ReactNode;
    resource?: RelatedRead<Preview>;
  },
) {
  const readiness = useContext(ListPreviewReadiness);
  const [representativeLabel, setRepresentativeLabel] = useState<string>();
  const selection = useRelatedExpansion(),
    surface = useContext(SurfaceContext),
    button = useRef<HTMLElement | null>(null);
  const path = props.to?.split(/[?#]/)[0], kind = path ? previewKind(path) : undefined;
  const read = useRelatedRead<Preview>(path, { resource });
  const item = read.preview.value;
  const cause = read.preview.error;
  const error = cause
    ? cause instanceof ApiError && cause.status === 404 && cause.code === "not_found" ? "missing" : "failed"
    : null;
  const enabled = !surface?.editor.current;
  useExpansionRegistration(kind ? path : undefined, enabled);
  const expanded = enabled && !!path && !!selection?.value.includes(path);
  const readKey = expanded ? path : null;
  const [ownedKey, setOwnedKey] = useState(readKey),
    [tagsReady, setTagsReady] = useState(false),
    [propertiesReady, setPropertiesReady] = useState(false);
  if (ownedKey !== readKey) {
    setOwnedKey(readKey);
    setTagsReady(false);
    setPropertiesReady(false);
  }
  const report = useRef<ReturnType<NonNullable<typeof readiness>["track"]> | null>(null);
  useLayoutEffect(() => {
    if (!expanded || !path || !readiness) return;
    const tracked = readiness.track(path);
    report.current = tracked;
    return () => {
      tracked.dispose();
      report.current = null;
    };
  }, [readiness, path, expanded]);
  const onTagsReady = useCallback((ready: boolean) => setTagsReady(ready), []);
  const onPropertiesReady = useCallback((ready: boolean) => setPropertiesReady(ready), []);
  useLayoutEffect(() => {
    report.current?.settle(!!fallback || !!error || !!item && tagsReady && (kind !== "entities" || propertiesReady));
  }, [item, error, tagsReady, propertiesReady, kind, readiness, expanded, fallback]);
  const hasFallback = !!fallback;
  useEffect(() => {
    if (!expanded || !path || hasFallback) {
      read.resource.closePreview();
      return;
    }
    void read.resource.read("preview");
    return () => read.resource.closePreview();
  }, [read.resource, path, expanded, hasFallback]);
  if (!selection || !path || !kind) return <RelatedItem {...props} />;
  if (!enabled) return <RelatedItem {...props} to={undefined} />;
  const toggle = () => {
    button.current = document.activeElement as HTMLElement;
    const top = button.current?.getBoundingClientRect().top;
    selection.toggle(path);
    requestAnimationFrame(() => {
      const target = button.current;
      if (!target?.isConnected || top === undefined) return;
      // Collapsing an earlier row must not move the newly activated title out of view.
      const shift = target.getBoundingClientRect().top - top;
      shiftScroll(target, shift);
    });
  };
  const viewable = !!item && !error;
  const viewProps = { title: "상세", "aria-label": `${props.title} 상세` };
  return (
    <RelatedItem
      {...props}
      titleLabel={props.titleLabel ?? (list && kind === "entities"
        ? undefined
        : `${!list && item && "title" in item && item.title !== props.title ? "당시 " : ""}${
          representativeLabel ?? (kind === "records" ? "본문 대표 문구" : kind === "tasks" ? "제목" : "자료 이름")
        }`)}
      to={undefined}
      action={
        <>
          {props.action}
          {viewable && (list
            ? (
              <Button asChild variant="ghost"><Link {...list.link()} {...viewProps}>
                <><EyeIcon data-icon="inline-start" />상세</>
              </Link></Button>
            )
            : (
              <Button asChild variant="ghost"><DetailLink {...viewProps} to={path} restoreKey={`view-related-${path}`}>
                <><EyeIcon data-icon="inline-start" />상세</>
              </DetailLink></Button>
            ))}
        </>
      }
      disclosure={{
        expanded,
        toggle,
        content: (
          <div className="flex min-w-0 flex-col gap-4" aria-busy={expanded && !item && !error || undefined}>
            {fallback}
            {!fallback && !item && !error && <p className="text-sm text-muted-foreground" role="status">불러오는 중…</p>}
            {!fallback && error === "missing" && (
              <p className="text-sm text-muted-foreground">삭제된 대상 또는 접근할 수 없는 대상입니다.</p>
            )}
            {!fallback && error === "failed" && (
              <>
                <Notice kind="error">내용을 불러오지 못했습니다.</Notice>
                <Button variant="ghost" type="button" onClick={() => void read.resource.read("preview")}>다시 시도</Button>
              </>
            )}
            {!fallback && item && (
              <>
                {list?.metadata}
                <PreviewContents
                  kind={kind}
                  item={item}
                  shownTitle={props.title}
                  main={!!list}
                  onTagsReady={onTagsReady}
                  onPropertiesReady={onPropertiesReady}
                  onRepresentativeLabel={setRepresentativeLabel}
                />
              </>
            )}
          </div>
        ),
      }}
    />
  );
}

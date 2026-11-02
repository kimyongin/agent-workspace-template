import { useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { EntityDetail } from "@contracts/entity.ts";
import type { TaskResult } from "@contracts/task.ts";
import { useSurfaceViewport } from "../../components/ConfirmDialog.tsx";
import { registerSurface } from "../../lib/surface-dom.ts";
import { DetailTabContext } from "../details/workspace-context.ts";
import { SurfaceContext } from "../../components/Modal.tsx";
import { Button } from "../../components/ui/button.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog.tsx";
import { MarkdownContent } from "../../components/MarkdownContent.tsx";
import { Notice } from "../../components/Field.tsx";
import { RelatedEmpty } from "../../components/RelatedItems.tsx";
import { useApi } from "../../lib/api-context.tsx";
import { ApiError } from "../../lib/api.ts";
import { useTaskAccess } from "../activity/task-access.ts";
import { useEntityReadAccess } from "./entity-access.ts";
import { createRelatedRead } from "../relations/related-read.ts";
import { useRelatedRead } from "../relations/useRelatedRead.ts";
import type { useEntityTaskRead } from "./TaskEntityRelations.tsx";

function remember(input: HTMLElement) {
  const text = input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement ? input : null;
  const parents: { node: HTMLElement; top: number; left: number }[] = [];
  for (let node = input.parentElement; node; node = node.parentElement) {
    parents.push({ node, top: node.scrollTop, left: node.scrollLeft });
  }
  return {
    input,
    start: text?.selectionStart ?? null,
    end: text?.selectionEnd ?? null,
    direction: text?.selectionDirection ?? null,
    top: input.scrollTop,
    left: input.scrollLeft,
    parents,
  };
}
/** A saved task can be read without navigating away from this entity's retained draft. */
export function EntityTaskReader({ entity, read, disabled }: {
  entity: EntityDetail;
  read: ReturnType<typeof useEntityTaskRead>;
  disabled: boolean;
}) {
  const api = useApi(), { canRead } = useTaskAccess(), canReadType = useEntityReadAccess();
  const surface = useContext(SurfaceContext), tab = useContext(DetailTabContext);
  const descriptionId = useId();
  const [content, setContent] = useState<HTMLDivElement | null>(null);
  const viewport = useRef<HTMLElement | null>(null);
  viewport.current = content;
  const body = useRef<HTMLDivElement>(null),
    heading = useRef<HTMLHeadingElement>(null),
    footer = useRef<HTMLDivElement>(null);
  useSurfaceViewport(viewport, content);
  const reading = useRef(false);
  const origin = useRef<ReturnType<typeof remember> | null>(null);
  const [open, setOpen] = useState(false), [selected, setSelected] = useState<string>();
  const [owner, setOwner] = useState({ api, id: entity.id });
  if (owner.api !== api || owner.id !== entity.id) {
    setOwner({ api, id: entity.id });
    setOpen(false);
    setSelected(undefined);
    origin.current = null;
  }
  const allowed = canRead && canReadType(entity.entity_type_id) && (tab?.active ?? true);
  const holdPresentation = surface?.holdPresentation;
  useLayoutEffect(() => {
    holdPresentation?.(open && allowed && !disabled);
    return () => holdPresentation?.(false);
  }, [holdPresentation, open, allowed, disabled]);
  const authority = useRef({ allowed, disabled });
  authority.current = { allowed, disabled };
  const path = open && allowed && !disabled && selected ? `/tasks/${selected}` : undefined;
  const resource = useMemo(
    () => createRelatedRead<TaskResult>({ load: (signal) => api("GET", path!, undefined, signal) }),
    [api, path],
  );
  const current = useRelatedRead<TaskResult>(path, { resource });
  useLayoutEffect(
    () =>
      content
        ? registerSurface(
          content,
          () => ({
            title: "관련 할 일 읽기",
            body: body.current,
            heading: heading.current,
            footer: footer.current,
            active: open && allowed && !disabled,
            modal: true,
            confirmation: false,
            ready: !current.preview.loading,
          }),
        )
        : undefined,
    [content, open, allowed, disabled, current.preview.loading],
  );
  useEffect(() => {
    if (path) void resource.read("preview");
    return () => resource.cancel();
  }, [resource, path]);
  useEffect(() => {
    if (!allowed || disabled) {
      setOpen(false);
      setSelected(undefined);
    }
  }, [allowed, disabled]);
  useEffect(() => {
    const slot = surface?.slot;
    if (!slot) return;
    const capture = (event: Event) => {
      const input = event.target;
      if (
        !reading.current && input instanceof HTMLElement &&
        (input.matches("[data-field-control]") || input instanceof HTMLInputElement ||
          input instanceof HTMLTextAreaElement) &&
        slot.contains(input)
      ) origin.current = remember(input);
    };
    const events = ["focusin", "focusout", "select", "keyup", "pointerup", "input", "scroll"];
    for (const name of events) slot.addEventListener(name, capture, true);
    return () => {
      for (const name of events) slot.removeEventListener(name, capture, true);
      origin.current = null;
    };
  }, [surface?.slot, api, entity.id]);
  const restore = () => {
    const saved = origin.current;
    if (
      !saved?.input.isConnected || !surface?.slot?.contains(saved.input) || !authority.current.allowed ||
      authority.current.disabled
    ) return;
    saved.input.focus({ preventScroll: true });
    if (
      (saved.input instanceof HTMLInputElement || saved.input instanceof HTMLTextAreaElement) && saved.start !== null &&
      saved.end !== null
    ) saved.input.setSelectionRange(saved.start, saved.end, saved.direction ?? undefined);
    saved.input.scrollTop = saved.top;
    saved.input.scrollLeft = saved.left;
    for (const parent of saved.parents) {
      if (parent.node.isConnected) {
        parent.node.scrollTop = parent.top;
        parent.node.scrollLeft = parent.left;
      }
    }
  };
  const begin = () => {
    if (!allowed || disabled) return;
    reading.current = true;
    setSelected(undefined);
    setOpen(true);
  };
  const close = () => {
    resource.closePreview();
    setOpen(false);
    setSelected(undefined);
  };
  const item = current.preview.value;
  const denied = current.preview.error instanceof ApiError && [403, 404].includes(current.preview.error.status);
  if (!allowed) return null;
  return (
    <>
      <Button type="button" variant="outline" disabled={disabled} onClick={begin}>관련 할 일</Button>
      <Dialog
        open={open && !disabled}
        onOpenChange={(next) => {
          if (!next) close();
        }}
      >
        <DialogContent
          ref={setContent}
          showCloseButton={false}
          aria-describedby={descriptionId}
          className="flex max-w-[calc(100%-1rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl"
          style={{
            maxHeight: "calc(var(--surface-height, 100dvh) - 1rem)",
            top: "calc(var(--surface-top, 0px) + var(--surface-height, 100dvh) / 2)",
          }}
          onPointerDownOutside={(event) => event.preventDefault()}
          onEscapeKeyDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            close();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            restore();
            reading.current = false;
          }}
        >
          <div
            ref={body}
            className="min-h-0 overflow-y-auto overscroll-contain"
            role="region"
            aria-label="관련 할 일 내용"
            tabIndex={0}
          >
            <DialogHeader className="p-4">
              <DialogTitle ref={heading}>관련 할 일 읽기</DialogTitle>
              <DialogDescription id={descriptionId}>
                현재 저장된 내용을 확인합니다. 자료의 미저장 내용은 유지됩니다.
              </DialogDescription>
            </DialogHeader>
            <div className="px-4 pb-4">
              <ul className="flex min-w-0 flex-col gap-2" aria-label="연결된 할 일">
                {read.items.map((task) => (
                  <li key={task.id}>
                    <Button
                      variant="outline"
                      type="button"
                      className="h-auto w-full justify-start whitespace-normal text-left"
                      onClick={() => {
                        if (selected === task.id) void resource.read("preview");
                        else setSelected(task.id);
                      }}
                    >
                      {task.title}
                    </Button>
                  </li>
                ))}
              </ul>
              {!read.items.length && !read.loading && !read.failed && <RelatedEmpty title="연결된 할 일이 없습니다." />}
              {read.failed && <Notice kind="error">연결된 할 일을 불러오지 못했습니다.</Notice>}
              {read.canReadMore && (
                <Button type="button" variant="ghost" disabled={read.loading} onClick={read.more}>
                  {read.loading ? "불러오는 중…" : read.failed ? "할 일 다시 시도" : "할 일 더 보기"}
                </Button>
              )}
              {selected && (
                <section
                  aria-label="선택한 할 일"
                  className="mt-4 flex min-w-0 flex-col gap-3"
                  aria-busy={current.preview.loading || undefined}
                >
                  {!item && !current.preview.error && <p role="status">불러오는 중…</p>}
                  {denied && <p>삭제된 할 일 또는 접근할 수 없는 할 일입니다.</p>}
                  {!!current.preview.error && !denied && (
                    <>
                      <Notice kind="error">할 일 내용을 불러오지 못했습니다.</Notice>
                      <Button type="button" variant="outline" onClick={() => void resource.read("preview")}>
                        내용 다시 시도
                      </Button>
                    </>
                  )}
                  {item && (item.deleted_at ? <p>삭제된 할 일입니다.</p> : (
                    <>
                      <h3 className="break-words font-semibold">{item.title}</h3>
                      {item.body ? <MarkdownContent text={item.body} /> : <p>본문이 없습니다.</p>}
                    </>
                  ))}
                </section>
              )}
            </div>
          </div>
          <DialogFooter ref={footer} className="m-0 shrink-0">
            <Button type="button" variant="outline" onClick={close}>편집으로 돌아가기</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

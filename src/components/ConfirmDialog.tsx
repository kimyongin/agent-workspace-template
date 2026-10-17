import { registerSurface } from "../lib/surface-dom.ts";
import { type ReactNode, type RefObject, useEffect, useId, useRef, useLayoutEffect } from "react";
import { createPortal } from "react-dom";

interface ConfirmProps {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog(
  { open, title, message, confirmLabel, danger, busy, confirmDisabled = false, onConfirm, onCancel }: ConfirmProps,
) {
  return (
    <ConfirmationSurface
      open={open}
      title={title}
      busy={busy}
      onCancel={onCancel}
      footer={
        <>
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>취소</button>
          <button
            type="button"
            className={danger ? "btn btn-danger" : "btn btn-primary"}
            onClick={onConfirm}
            disabled={busy || confirmDisabled}
          >
            {busy ? "처리 중…" : confirmLabel}
          </button>
        </>
      }
    >
      <div>{message}</div>
    </ConfirmationSurface>
  );
}

/** A short native modal above the retained editing surface; only the top dialog is interactive. */
export function ConfirmationSurface({ open, title, busy = false, onCancel, footer, children, closeButton = false }: {
  open: boolean;
  title: string;
  busy?: boolean;
  onCancel: () => void;
  footer: ReactNode;
  children: ReactNode;
  closeButton?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const body = useRef<HTMLDivElement>(null), heading = useRef<HTMLHeadingElement>(null), footerElement = useRef<HTMLDivElement>(null);
  const elements = useRef({ title, body: body.current, heading: heading.current, footer: footerElement.current, active: open, modal: true, confirmation: true, ready: true });
  useLayoutEffect(() => { elements.current = { title, body: body.current, heading: heading.current, footer: footerElement.current, active: open, modal: true, confirmation: true, ready: true }; });
  useLayoutEffect(() => ref.current ? registerSurface(ref.current, () => elements.current) : undefined, [open]);
  useSurfaceViewport(ref);
  useEffect(() => {
    const dialog = ref.current;
    if (!open || !dialog) return;
    const returnFocus = document.activeElement as HTMLElement | null;
    dialog.showModal();
    (dialog.querySelector<HTMLElement>("textarea:not(:disabled), input:not(:disabled)") ??
      footerElement.current?.querySelector<HTMLElement>("button:not(:disabled)"))?.focus();
    return () => {
      dialog.close();
      if (returnFocus?.isConnected) returnFocus.focus();
    };
  }, [open]);
  const cancel = () => {
    if (!busy) onCancel();
  };
  return createPortal(
    <dialog
      ref={ref}
      className="modal modal-confirm modal-action"
      aria-labelledby={titleId}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          cancel();
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        cancel();
      }}
    >
      <div className="modal-inner">
        <div className="modal-head">
          <h2 ref={heading} id={titleId} className="dialog-title">{title}</h2>
          {closeButton && (
            <button
              type="button"
              className="btn btn-text modal-icon"
              aria-label="닫기"
              title="닫기"
              disabled={busy}
              onClick={cancel}
            >
              <span aria-hidden="true">×</span>
            </button>
          )}
        </div>
        <div ref={body} className="modal-body form">{children}</div>
        <div ref={footerElement} className="modal-foot">{footer}</div>
      </div>
    </dialog>,
    document.body,
  );
}

export function useSurfaceViewport(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const viewport = window.visualViewport;
    const resize = () => {
      const zoom = Number.parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
      ref.current?.style.setProperty("--surface-height", `${(viewport?.height ?? window.innerHeight) / zoom}px`);
      ref.current?.style.setProperty("--surface-top", `${(viewport?.offsetTop ?? 0) / zoom}px`);
    };
    // Root CSS zoom can change without a visualViewport resize; keep the same visible surface bound.
    const rootStyle = new MutationObserver(resize);
    rootStyle.observe(document.documentElement, { attributes: true, attributeFilter: ["style"] });
    resize();
    window.addEventListener("resize", resize);
    viewport?.addEventListener("resize", resize);
    viewport?.addEventListener("scroll", resize);
    return () => {
      rootStyle.disconnect();
      window.removeEventListener("resize", resize);
      viewport?.removeEventListener("resize", resize);
      viewport?.removeEventListener("scroll", resize);
    };
  }, [ref]);
}

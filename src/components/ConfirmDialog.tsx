import { type ReactNode, type RefObject, useEffect, useId, useRef } from "react";
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
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  useSurfaceViewport(ref);
  const returnFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      returnFocus.current = document.activeElement as HTMLElement;
      d.showModal();
      cancelRef.current?.focus();
    } else if (!open && d.open) {
      d.close();
      returnFocus.current?.focus();
    }
  }, [open]);
  useEffect(() => () => {
    if (ref.current?.open) ref.current.close();
    returnFocus.current?.focus();
  }, []);
  return createPortal(
    <dialog
      ref={ref}
      className="modal modal-confirm modal-action"
      aria-labelledby={titleId}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          if (!busy) onCancel();
        }
      }}
      onCancel={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!busy) onCancel();
      }}
    >
      <div className="modal-inner">
        <div className="modal-head">
          <h2 id={titleId} className="dialog-title">{title}</h2>
        </div>
        <div className="modal-body form">
          <div>{message}</div>
        </div>
        <div className="modal-foot">
          <button ref={cancelRef} type="button" className="btn" onClick={onCancel} disabled={busy}>
            취소
          </button>
          <button
            type="button"
            className={danger ? "btn btn-danger" : "btn btn-primary"}
            onClick={onConfirm}
            disabled={busy || confirmDisabled}
          >
            {busy ? "처리 중…" : confirmLabel}
          </button>
        </div>
      </div>
    </dialog>,
    document.body,
  );
}

export function useSurfaceViewport(ref: RefObject<HTMLDialogElement | null>) {
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

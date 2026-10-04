// ModalShell·ConfirmDialog: 네이티브 <dialog>의 showModal로 뒤 화면을 inert 처리하고 초점을 가둔다.
// Escape·닫기는 같은 미저장 보호를 거치며 배경 클릭으로 초안을 버리지 않는다(docs/design/ui-patterns.md).
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { useBlocker } from "react-router";

interface ModalProps {
  title: string;
  open: boolean;
  /** 닫기 요청. dirty면 변경 버리기 확인을 먼저 묻는다. */
  onClose: () => void;
  /** 경로 폐기 확인 후 편집 영역만 닫거나 초기화한다. 이동하는 onClose는 별도 콜백을 반드시 제공한다. */
  onRouteDiscard?: () => void;
  dirty?: boolean;
  /** 저장 중에는 닫지 않는다. */
  busy?: boolean;
  footer?: ReactNode | ((requestClose: () => void) => ReactNode);
  children: ReactNode;
}

export function ModalShell(props: ModalProps) {
  return props.open ? <ActiveModalShell {...props} /> : null;
}

function ActiveModalShell({ title, open, onClose, onRouteDiscard = onClose, dirty = false, busy = false, footer, children }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const returnFocus = useRef<Element | null>(null);
  const blocker = useBlocker(open && (dirty || busy));
  useEffect(() => { if (busy && blocker.state === "blocked") blocker.reset(); }, [busy, blocker]);
  useEffect(() => {
    const unload = (e: BeforeUnloadEvent) => { if (open && (dirty || busy)) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", unload);
    return () => window.removeEventListener("beforeunload", unload);
  }, [open, dirty, busy]);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      returnFocus.current = document.activeElement;
      d.showModal();
    } else if (!open && d.open) {
      d.close();
      (returnFocus.current as HTMLElement | null)?.focus?.();
    }
    return () => {
      if (d.open) {
        d.close();
        (returnFocus.current as HTMLElement | null)?.focus?.();
      }
    };
  }, [open]);

  const requestClose = () => {
    if (busy) return;
    if (dirty) setConfirmDiscard(true);
    else onClose();
  };

  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        if (!confirmDiscard) requestClose();
      }}
    >
      <div className="modal-inner">
        <div className="modal-head">
          <h2 id={titleId} className="dialog-title">{title}</h2>
          <button type="button" className="btn btn-text" onClick={requestClose} disabled={busy}>
            닫기
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{typeof footer === "function" ? footer(requestClose) : footer}</div>}
      </div>
      <ConfirmDialog
        open={confirmDiscard || blocker.state === "blocked"}
        busy={busy}
        title="변경을 버릴까요?"
        message="저장하지 않은 내용이 사라집니다."
        confirmLabel="변경 버리기"
        onConfirm={() => {
          setConfirmDiscard(false);
          if (blocker.state === "blocked") { onRouteDiscard(); blocker.proceed(); }
          else onClose();
        }}
        onCancel={() => { setConfirmDiscard(false); if (blocker.state === "blocked") blocker.reset(); }}
      />
    </dialog>
  );
}

interface ConfirmProps {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ open, title, message, confirmLabel, danger, busy, onConfirm, onCancel }: ConfirmProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      cancelRef.current?.focus();
    } else if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="modal modal-confirm"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onCancel();
      }}
    >
      <div className="modal-inner">
        <div className="modal-body form">
          <h2 id={titleId} className="dialog-title">{title}</h2>
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
            disabled={busy}
          >
            {busy ? "처리 중…" : confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}

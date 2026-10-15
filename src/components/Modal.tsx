// Native dialogs use showModal for mobile/confirmation and show for the docked desktop detail.
// Escape·닫기는 같은 미저장 보호를 거치며 배경 클릭으로 초안을 버리지 않는다(docs/design/ui-patterns.md).
import { createContext, type ReactNode, type RefObject, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useBlocker } from "react-router";
import { createPortal } from "react-dom";
import { ConfirmDialog, ConfirmationSurface, useSurfaceViewport } from "./ConfirmDialog.tsx";
export { ConfirmDialog } from "./ConfirmDialog.tsx";
import { useDetailExploration } from "../lib/detail-exploration.tsx";
import { RelatedExpansionProvider } from "./RelatedItems.tsx";
import { DetailTabContext, WorkspaceContext, type WorkspaceGuard } from "../features/details/workspace-context.ts";

export interface ModalProps {
  title: string;
  description?: string;
  /** Stable visible domain heading; the accessible name retains the current operation. */
  domain?: string;
  headingLevel?: 1 | 2;
  open: boolean;
  /** 닫기 요청. dirty면 변경 버리기 확인을 먼저 묻는다. */
  onClose: () => void;
  /** Footer cancellation returns to the viewer; header dismissal exits the detail. */
  onCancelEdit?: () => void;
  previous?: { label: string; back: () => void } | null;
  /** 경로 폐기 확인 후 편집 영역만 닫거나 초기화한다. 이동하는 onClose는 별도 콜백을 반드시 제공한다. */
  onRouteDiscard?: () => void;
  dirty?: boolean;
  /** 저장 중에는 닫지 않는다. */
  busy?: boolean;
  footer?: ReactNode | ((requestClose: () => void) => ReactNode);
  children: ReactNode;
}

export interface SurfaceEditor {
  title: string;
  description?: string;
  domain?: string;
  dirty: boolean;
  busy: boolean;
  onClose: () => void;
  onRouteDiscard?: () => void;
  footer: ModalProps["footer"];
}
export const SurfaceContext = createContext<{slot: HTMLDivElement | null; editor: RefObject<SurfaceEditor | null>; busy: RefObject<boolean>; register: (editor: SurfaceEditor | null) => void; onError?: (error: unknown) => void} | null>(null);

export interface SurfaceAction {
  title: string;
  body: ReactNode;
  footer: ReactNode;
  busy: boolean;
  onCancel: () => void;
}
/** Short actions open above this retained viewing/editing surface. */
export const SurfaceActionContext = createContext<((action: SurfaceAction | null) => void) | null>(null);

/** URL detail and its editor share one native dialog, focus trap and scroll surface. */
export function DetailSurface({title, description, tabTitle = title, onClose, children, busy = false, footer, onError}: {title: string; description?: string; tabTitle?: string; onClose: () => void; children: ReactNode; busy?: boolean; footer?: ReactNode; onError?: (error: unknown) => void}) {
  const previous = useDetailExploration();
  const tab = useContext(DetailTabContext);
  useEffect(() => { tab?.title(tabTitle); }, [tabTitle, tab?.title]);
  const [editor, setEditor] = useState<SurfaceEditor | null>(null);
  const [dismissing,setDismissing]=useState(false);
  const editorRef = useRef<SurfaceEditor | null>(null), busyRef = useRef(busy);
  const readFocus=useRef<HTMLElement|null>(null);
  busyRef.current = busy;
  const register = useCallback((value: SurfaceEditor | null) => {
    if(value&&!readFocus.current)readFocus.current=document.activeElement as HTMLElement;
    editorRef.current=value; setEditor(value);
  }, []);
  useEffect(()=>{if(!editor&&readFocus.current){if(readFocus.current.isConnected)readFocus.current.focus();else document.querySelector<HTMLElement>("dialog[open]:not(.modal-confirm) .modal-foot button")?.focus();readFocus.current=null;}},[editor]);
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  const dismiss=()=>{
    const active=editorRef.current;
    if(!active)return tab ? tab.close() : onClose();
    (active.onRouteDiscard??active.onClose)();
    setDismissing(true);
  };
  // Remove the editor before navigating, so its dirty guard cannot ask a second time.
  useEffect(()=>{if(dismissing&&!editor){setDismissing(false);if(tab)tab.close();else onClose();}},[dismissing,editor,onClose,tab]);
  return <RelatedExpansionProvider><SurfaceContext.Provider value={{slot, register, editor:editorRef, busy:busyRef, onError}}>
    <ModalShell open title={editor?.title ?? title} description={editor ? editor.description : description} domain={editor?.domain} headingLevel={editor || tab ? 2 : 1} onClose={dismiss} onCancelEdit={editor?.onClose}
      onRouteDiscard={editor?.onRouteDiscard} dirty={editor?.dirty} busy={busy || editor?.busy}
      previous={tab?.previous ?? (editor ? null : previous)} footer={editor?.footer ?? footer}>
      <div hidden={!!editor}>{children}</div>
      <div ref={setSlot} hidden={!editor} />
    </ModalShell>
  </SurfaceContext.Provider></RelatedExpansionProvider>;
}

export function DetailTitle({children}: {children: ReactNode}) {
  const tab = useContext(DetailTabContext);
  return tab ? <h3 className="detail-title">{children}</h3> : <h2 className="detail-title">{children}</h2>;
}

export function ModalShell(props: ModalProps) {
  return props.open ? <ActiveModalShell {...props} /> : null;
}

function ActiveModalShell({ title, description, domain, headingLevel=2, open, onClose, onCancelEdit, previous, onRouteDiscard = onClose, dirty = false, busy = false, footer, children }: ModalProps) {
  const tab = useContext(DetailTabContext);
  const workspace = useContext(WorkspaceContext);
  const active = tab?.active ?? true;
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const discardDestination=useRef(onClose);
  const [action, setAction] = useState<SurfaceAction | null>(null);
  const actionRef = useRef<SurfaceAction | null>(null);
  const registerAction = useCallback((value: SurfaceAction | null) => { actionRef.current=value; setAction(value); }, []);
  const actionOpen = !!action;
  const actionFocus = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (actionOpen) actionFocus.current = document.activeElement as HTMLElement;
  }, [actionOpen]);
  const docked = !!tab?.docked;
  // Reopening the parent would lift it above its confirmation. Defer only its native mode switch.
  const nativeDocked = useRef(docked);
  if (!actionOpen) nativeDocked.current = docked;
  const dialogDocked = nativeDocked.current;
  useEffect(() => {
    if (!actionOpen) ref.current?.querySelector<HTMLElement>("form [aria-invalid='true']")?.focus();
  }, [actionOpen]);
  const surface = useContext(SurfaceContext);
  const returnFocus = useRef<Element | null>(null);
  const guard = useRef({open,dirty,busy,surface,action});
  guard.current = {open,dirty,busy,surface,action};
  // The router keeps this callback; it reads the committed mode instead of a previous editor's boolean.
  const shouldBlock = useCallback(() => {
    const state=guard.current;
    return state.open && (!!actionRef.current || (state.surface ? !!state.surface.editor.current?.dirty || !!state.surface.editor.current?.busy || state.surface.busy.current : state.dirty || state.busy));
  }, []);
  const readGuard = useRef<() => WorkspaceGuard>(() => ({ dirty: false, busy: false, retained: false, discard: () => {} }));
  readGuard.current = () => ({
    dirty: !!actionRef.current || (surface ? !!surface.editor.current?.dirty : dirty),
    // A removed surface editor must not retain its previous render's busy prop.
    busy: !!actionRef.current?.busy || (surface ? !!surface.editor.current?.busy || surface.busy.current : busy),
    retained: !!tab,
    discard: onRouteDiscard,
  });
  const guardId = useId();
  useEffect(() => workspace && !tab ? workspace.registerGuard(guardId, () => readGuard.current()) : undefined, [workspace?.registerGuard, !!tab, guardId]);
  useLayoutEffect(() => { tab?.guard(readGuard.current()); });
  useEffect(() => {
    const unload = (e: BeforeUnloadEvent) => { if (open && (dirty || busy || actionOpen)) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", unload);
    return () => window.removeEventListener("beforeunload", unload);
  }, [open, dirty, busy, actionOpen]);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && active && !d.open) {
      returnFocus.current = document.activeElement;
      if (dialogDocked) d.show(); else d.showModal();
      (d.querySelector<HTMLElement>("form [aria-invalid='true']") ??
        (actionFocus.current?.isConnected ? actionFocus.current : null) ??
        d.querySelector<HTMLElement>("form input, form textarea, form select") ??
        d.querySelector<HTMLElement>(".dialog-title"))?.focus();
    } else if ((!open || !active) && d.open) {
      d.close();
      if (!tab) (returnFocus.current as HTMLElement | null)?.focus?.();
    }
    return () => {
      if (d.open) {
        d.close();
        if (!tab) (returnFocus.current as HTMLElement | null)?.focus?.();
      }
    };
  }, [open, active, dialogDocked]);
  useEffect(() => { if (!actionOpen) actionFocus.current = null; }, [actionOpen]);

  useEffect(() => {
    if (docked || !active) return;
    const overflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => { document.documentElement.style.overflow = overflow; };
  }, [docked, active]);

  useSurfaceViewport(ref);
  const requestLeave = (destination:()=>void) => {
    if (busy || action?.busy) return;
    if (action) return action.onCancel();
    if (dirty) {discardDestination.current=destination;setConfirmDiscard(true);}
    else destination();
  };
  const requestClose=()=>requestLeave(onClose);
  const requestCancelEdit=()=>requestLeave(onCancelEdit??onClose);
  // Capture Escape even if cancelling a stage temporarily leaves focus outside the dialog.
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      const top = Array.from(document.querySelectorAll<HTMLDialogElement>("dialog[open]")).at(-1);
      if (event.key !== "Escape" || !active || (docked ? !ref.current?.contains(event.target as Node) || !!document.querySelector("dialog.modal-confirm[open]") : top !== ref.current)) return;
      event.preventDefault(); event.stopPropagation();
      if (!confirmDiscard) requestClose();
    };
    document.addEventListener("keydown", escape, true);
    return () => document.removeEventListener("keydown", escape, true);
  });

  return <SurfaceActionContext.Provider value={registerAction}><dialog
      ref={ref}
      className={`modal${docked ? " detail-docked" : ""}`}
      aria-label={domain ? title : undefined}
      aria-labelledby={domain ? undefined : titleId}
      aria-describedby={description ? `${titleId}-description` : undefined}
      onCancel={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!confirmDiscard) requestClose();
      }}
    >
      <div className="modal-inner">
        <div className="modal-head">
          {previous && <button type="button" className="btn btn-text modal-icon modal-back" aria-label={previous.label} title={previous.label} disabled={busy} onClick={()=>tab ? previous.back() : requestLeave(previous.back)}><span aria-hidden="true">←</span></button>}
          {headingLevel===1?<h1 id={titleId} className="dialog-title" tabIndex={-1}>{domain ?? title}</h1>:<h2 id={titleId} className="dialog-title" tabIndex={-1}>{domain ?? title}</h2>}
          {!docked && <button type="button" className="btn btn-text modal-icon" aria-label="닫기" title="닫기" onClick={requestClose} disabled={busy || action?.busy}>
            <span aria-hidden="true">×</span>
          </button>}
          {description && <p id={`${titleId}-description`} className="page-description">{description}</p>}
        </div>
        <div className="modal-body" tabIndex={0}>{children}</div>
        {footer && <div className="modal-foot">{typeof footer === "function" ? footer(requestCancelEdit) : footer}</div>}
      </div>
      {action && <ConfirmationSurface open title={action.title} busy={action.busy} onCancel={action.onCancel}
        closeButton footer={action.footer}><div className="surface-action">{action.body}</div></ConfirmationSurface>}
      <ConfirmDialog
        open={confirmDiscard}
        busy={busy || action?.busy}
        title="변경을 버릴까요?"
        message="저장하지 않은 내용이 사라집니다."
        confirmLabel="변경 버리기"
        onConfirm={() => {
          setConfirmDiscard(false);
          discardDestination.current();
        }}
        onCancel={() => setConfirmDiscard(false)}
      />
      {!workspace && <LocalModalRouteProtection shouldBlock={shouldBlock} busy={busy || !!action?.busy} discard={onRouteDiscard}/>}
    </dialog></SurfaceActionContext.Provider>;
}

/** Standalone pending mutation guard; general surfaces already own their router guard. */
function LocalModalRouteProtection({ shouldBlock, busy, discard }: { shouldBlock: () => boolean; busy: boolean; discard: () => void }) {
  const blocker = useBlocker(shouldBlock);
  useEffect(() => { if (busy && blocker.state === "blocked") blocker.reset(); }, [busy, blocker]);
  return <ConfirmDialog open={!busy && blocker.state === "blocked"} title="변경을 버릴까요?" message="저장하지 않은 내용이 사라집니다." confirmLabel="변경 버리기"
    onConfirm={() => { if (blocker.state === "blocked") { discard(); blocker.proceed(); } }}
    onCancel={() => { if (blocker.state === "blocked") blocker.reset(); }}/>
}

export function BusyNavigationGuard({pending}: {pending: RefObject<boolean>}) {
  const shouldBlock = useCallback(() => pending.current, [pending]);
  const blocker = useBlocker(shouldBlock);
  useEffect(() => {
    if(blocker.state === "blocked") blocker.reset();
  }, [blocker]);
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => {
      if(pending.current) { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("beforeunload", unload);
    return () => window.removeEventListener("beforeunload", unload);
  }, [pending]);
  return null;
}

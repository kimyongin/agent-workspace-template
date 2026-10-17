import { PopupContainerContext } from "./ui/portal-container.tsx";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog.tsx";
import { Button } from "./ui/button.tsx";
import { ArrowLeftIcon, XIcon } from "lucide-react";
import { firstField, hasActiveConfirmation, registerSurface, surfaceFor } from "../lib/surface-dom.ts";
// Official Dialog owns mobile modality; a stable portal host retains the same editor in the desktop panel.
// Escape·닫기는 같은 미저장 보호를 거치며 배경 클릭으로 초안을 버리지 않는다(docs/design/ui-patterns.md).
import { useNavigationBlocker } from "../lib/navigation-protection.tsx";
import { createContext, type ReactNode, type RefObject, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
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
  ready?: boolean;
  navigationTitle?: string;
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
export const SurfaceContext = createContext<{slot: HTMLDivElement | null; editor: RefObject<SurfaceEditor | null>; busy: RefObject<boolean>; register: (editor: SurfaceEditor | null) => void; onError?: (error: unknown) => void; protection: RefObject<SurfaceProtection | null>; protect: (value: SurfaceProtection | null) => void} | null>(null);

export interface SurfaceProtection { dirty: boolean; busy: boolean; discard: () => void }

export interface SurfaceAction {
  title: string;
  body: ReactNode;
  footer: ReactNode;
  busy: boolean;
  onCancel: () => void;
}
/** Short actions open above this retained viewing/editing surface. */
export const SurfaceActionContext = createContext<((action: SurfaceAction | null) => void) | null>(null);

/** URL detail and its editor share one retained dialog and scroll surface. */
export function DetailSurface({title, description, tabTitle = title, onClose, children, busy = false, footer, onError, ready = true}: {title: string; description?: string; tabTitle?: string; onClose: () => void; children: ReactNode; busy?: boolean; footer?: ReactNode; onError?: (error: unknown) => void; ready?: boolean}) {
  const previous = useDetailExploration();
  const tab = useContext(DetailTabContext);
  useEffect(() => { tab?.title(tabTitle); }, [tabTitle, tab?.title]);
  const [editor, setEditor] = useState<SurfaceEditor | null>(null);
  const [protection, setProtection] = useState<SurfaceProtection | null>(null);
  const protectionRef = useRef(protection);
  protectionRef.current = protection;
  const protect = useCallback((value: SurfaceProtection | null) => { protectionRef.current = value; setProtection(value); }, []);
  const [dismissing,setDismissing]=useState(false);
  const editorRef = useRef<SurfaceEditor | null>(null), busyRef = useRef(busy);
  const readFocus=useRef<HTMLElement|null>(null);
  const root = useRef<HTMLDivElement>(null);
  busyRef.current = busy;
  const register = useCallback((value: SurfaceEditor | null) => {
    if(value&&!readFocus.current)readFocus.current=document.activeElement as HTMLElement;
    editorRef.current=value; setEditor(value);
  }, []);
  useEffect(()=>{if(!editor&&readFocus.current){if(readFocus.current.isConnected)readFocus.current.focus();else surfaceFor(root.current)?.footer?.querySelector<HTMLElement>("button:not(:disabled)")?.focus();readFocus.current=null;}},[editor]);
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  const dismiss=()=>{
    const active=editorRef.current;
    if(!active){if(protectionRef.current){protectionRef.current.discard();setDismissing(true);return;}return tab ? tab.close() : onClose();}
    (active.onRouteDiscard??active.onClose)();
    setDismissing(true);
  };
  // Remove the editor before navigating, so its dirty guard cannot ask a second time.
  useEffect(()=>{if(dismissing&&!editor&&!protection){setDismissing(false);if(tab)tab.close();else onClose();}},[dismissing,editor,protection,onClose,tab]);
  return <RelatedExpansionProvider><SurfaceContext.Provider value={{slot, register, editor:editorRef, busy:busyRef, onError, protection: protectionRef, protect}}>
    <ModalShell open ready={ready} navigationTitle={tabTitle} title={editor?.title ?? title} description={editor ? editor.description : description} domain={editor?.domain} headingLevel={editor || tab ? 2 : 1} onClose={dismiss} onCancelEdit={editor?.onClose}
      onRouteDiscard={editor?.onRouteDiscard ?? (protection ? () => protectionRef.current?.discard() : undefined)} dirty={editor?.dirty || protection?.dirty} busy={busy || editor?.busy || protection?.busy}
      previous={tab?.previous ?? (editor ? null : previous)} footer={editor?.footer ?? (protection?.dirty ? <fieldset className="flex flex-wrap items-center gap-2 border-0 p-0" disabled>{footer}</fieldset> : footer)}>
      <div ref={root} hidden={!!editor}>{children}</div>
      <div ref={setSlot} hidden={!editor} />
    </ModalShell>
  </SurfaceContext.Provider></RelatedExpansionProvider>;
}

export function DetailTitle({children}: {children: ReactNode}) {
  const tab = useContext(DetailTabContext);
  return tab ? <h3 className="break-words text-lg font-semibold leading-snug">{children}</h3> : <h2 className="break-words text-lg font-semibold leading-snug">{children}</h2>;
}

export function ModalShell(props: ModalProps) {
  return props.open ? <ActiveModalShell {...props} /> : null;
}

function ActiveModalShell({ title, description, domain, headingLevel=2, open, onClose, onCancelEdit, previous, onRouteDiscard = onClose, dirty = false, busy = false, footer, children, ready = true, navigationTitle = title }: ModalProps) {
  const tab = useContext(DetailTabContext);
  const workspace = useContext(WorkspaceContext);
  const active = tab?.active ?? true;
  const [host] = useState(() => document.createElement("div"));
  const ref = useRef<HTMLElement>(host);
  const desktopSlot = useRef<HTMLDivElement>(null);
  const mobileSlot = useRef<HTMLDivElement>(null);
  const [mobileContent, setMobileContent] = useState<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLElement | null>(null); viewportRef.current = mobileContent;
  const bodyRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const discardDestination=useRef(onClose);
  const [action, setAction] = useState<SurfaceAction | null>(null);
  const actionRef = useRef<SurfaceAction | null>(null);
  const registerAction = useCallback((value: SurfaceAction | null) => { actionRef.current=value; setAction(value); }, []);
  const actionOpen = !!action;
  const retainedFocus = useRef<HTMLElement | null>(null);
  if (host.contains(document.activeElement)) retainedFocus.current = document.activeElement as HTMLElement;
  const docked = !!tab?.docked;
  // The portal target never changes. Only its containing layout slot moves.
  // React therefore retains form state, DOM selection, scroll and nested guards.
  const [presentDocked, setPresentDocked] = useState(docked);
  useLayoutEffect(() => { if (!actionOpen) setPresentDocked(docked); }, [docked, actionOpen]);
  const dialogDocked = presentDocked;
  const elements = useRef({ title: navigationTitle, body: bodyRef.current, heading: headingRef.current, footer: footerRef.current, active: false, modal: false, confirmation: false, ready });
  useLayoutEffect(() => { elements.current = { title: navigationTitle, body: bodyRef.current, heading: headingRef.current, footer: footerRef.current, active: open && active, modal: !dialogDocked, confirmation: false, ready }; });
  useLayoutEffect(() => registerSurface(host, () => elements.current), [host, open, active]);
  const attach = useCallback((slot: HTMLDivElement | null) => {
    if (!slot) return;
    const focused = host.contains(document.activeElement) ? document.activeElement as HTMLElement : null;
    if (host.parentElement === slot) return;
    slot.appendChild(host);
    if (focused?.isConnected) focused.focus({ preventScroll: true });
  }, [host]);
  useLayoutEffect(() => {
    host.className = "flex h-full min-h-0 flex-col";
    host.hidden = !active;
    if (dialogDocked) attach(desktopSlot.current); else attach(mobileSlot.current);
  }, [host, attach, active, dialogDocked]);
  useEffect(() => {
    if (!actionOpen) ref.current?.querySelector<HTMLElement>("form [aria-invalid='true']")?.focus();
  }, [actionOpen]);
  const surface = useContext(SurfaceContext);
  const returnFocus = useRef<Element | null>(null);
  const guard = useRef({open,dirty,busy,surface,action});
  guard.current = {open,dirty,busy,surface,action};
  // The router keeps this callback. Surface refs distinguish a live child draft from
  // dirty props rendered by an editor that has already saved and unregistered.
  const shouldBlock = useCallback(() => {
    const state=guard.current;
    return state.open && (!!actionRef.current || (state.surface ? !!state.surface.protection.current?.dirty || !!state.surface.protection.current?.busy || !!state.surface.editor.current?.dirty || !!state.surface.editor.current?.busy || state.surface.busy.current : state.dirty || state.busy));
  }, []);
  const readGuard = useRef<() => WorkspaceGuard>(() => ({ dirty: false, busy: false, retained: false, discard: () => {} }));
  readGuard.current = () => ({
    dirty: !!actionRef.current || (surface ? !!surface.protection.current?.dirty || !!surface.editor.current?.dirty : dirty),
    // A removed surface editor must not retain its previous render's busy prop.
    busy: !!actionRef.current?.busy || (surface ? !!surface.protection.current?.busy || !!surface.editor.current?.busy || surface.busy.current : busy),
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
    if (!active) return;
    returnFocus.current = document.activeElement;
    return () => { if (!tab && returnFocus.current instanceof HTMLElement && returnFocus.current.isConnected) returnFocus.current.focus(); };
  }, [active, !!tab]);
  useSurfaceViewport(viewportRef, mobileContent);
  const requestLeave = (destination:()=>void) => {
    if (busy || action?.busy) return;
    if (action) return action.onCancel();
    if (dirty) {discardDestination.current=destination;setConfirmDiscard(true);}
    else destination();
  };
  const requestClose=()=>requestLeave(onClose);
  const requestCancelEdit=()=>requestLeave(onCancelEdit??onClose);
  useEffect(() => {
    if (!active || !dialogDocked) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || hasActiveConfirmation()) return;
      event.preventDefault(); event.stopPropagation(); requestClose();
    };
    host.addEventListener("keydown", escape);
    return () => host.removeEventListener("keydown", escape);
  });
  const initialFocus = () => {
    const control = ref.current?.querySelector<HTMLElement>("[aria-invalid='true']")
      ?? (retainedFocus.current?.isConnected ? retainedFocus.current : null)
      ?? firstField(ref.current?.querySelector("form") ?? null) ?? headingRef.current;
    control?.focus({ preventScroll: true });
  };
  useEffect(() => { if (active && dialogDocked) initialFocus(); }, [active, dialogDocked]);
  const contents = <>
    <DialogHeader className="shrink-0 p-4">
      <div className="flex min-w-0 items-start gap-2">
        {previous && <Button type="button" variant="ghost" size="icon" aria-label={previous.label} disabled={busy} onClick={() => tab ? previous.back() : requestLeave(previous.back)}><ArrowLeftIcon /></Button>}
        <DialogTitle asChild>{headingLevel === 1 ? <h1 ref={headingRef} id={titleId} className="min-w-0 flex-1 break-words outline-none" tabIndex={-1}>{domain ?? title}</h1> : <h2 ref={headingRef} id={titleId} className="min-w-0 flex-1 break-words outline-none" tabIndex={-1}>{domain ?? title}</h2>}</DialogTitle>
        {!dialogDocked && <Button type="button" variant="ghost" size="icon" aria-label="닫기" onClick={requestClose} disabled={busy || action?.busy}><XIcon /></Button>}
      </div>
      {description && <DialogDescription id={`${titleId}-description`}>{description}</DialogDescription>}
    </DialogHeader>
    <div ref={bodyRef} role="region" aria-label="상세 내용" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4" aria-busy={!ready || undefined} tabIndex={0}>{children}</div>
    {footer && <DialogFooter ref={footerRef} className="m-0 shrink-0 rounded-none">{typeof footer === "function" ? footer(requestCancelEdit) : footer}</DialogFooter>}
  </>;
  return <SurfaceActionContext.Provider value={registerAction}><Dialog open={open && active && !dialogDocked} onOpenChange={next => { if (!next) requestClose(); }}>
    <div ref={desktopSlot} hidden={!dialogDocked || !active} role={dialogDocked ? "dialog" : undefined} aria-label={domain ? title : undefined} aria-labelledby={domain ? undefined : titleId} aria-describedby={description ? `${titleId}-description` : undefined} className="flex h-full min-h-0 flex-col" />
    <DialogContent ref={setMobileContent} aria-modal={true} showCloseButton={false} aria-label={domain ? title : undefined} aria-labelledby={domain ? undefined : titleId} aria-describedby={description ? `${titleId}-description` : undefined}
      className="flex h-[min(48rem,calc(100dvh-2rem))] max-w-[calc(100%-1rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl"
      style={{ maxHeight: "calc(var(--surface-height, 100dvh) - 1rem)", top: "calc(var(--surface-top, 0px) + var(--surface-height, 100dvh) / 2)" }}
      onOpenAutoFocus={event => { event.preventDefault(); initialFocus(); }}
      onCloseAutoFocus={event => { event.preventDefault(); }}
      onPointerDownOutside={event => event.preventDefault()}
      onInteractOutside={event => event.preventDefault()}
      onEscapeKeyDown={event => { event.preventDefault(); event.stopPropagation(); requestClose(); }}>
      <div className="flex h-full min-h-0 flex-col" ref={node => { mobileSlot.current = node; if (!dialogDocked) attach(node); }} />
    </DialogContent>
    {createPortal(<PopupContainerContext.Provider value={host}>{contents}</PopupContainerContext.Provider>, host)}
    {action && <ConfirmationSurface open title={action.title} busy={action.busy} onCancel={action.onCancel} closeButton footer={action.footer}>{action.body}</ConfirmationSurface>}
    <ConfirmDialog open={confirmDiscard} busy={busy || action?.busy} title="변경을 버릴까요?" message="저장하지 않은 내용이 사라집니다." confirmLabel="변경 버리기" onConfirm={() => { setConfirmDiscard(false); discardDestination.current(); }} onCancel={() => setConfirmDiscard(false)} />
    {!workspace && <LocalModalRouteProtection shouldBlock={shouldBlock} busy={busy || !!action?.busy} discard={onRouteDiscard} />}
  </Dialog></SurfaceActionContext.Provider>;

}

/** Standalone pending mutation guard; general surfaces already own their router guard. */
function LocalModalRouteProtection({ shouldBlock, busy, discard }: { shouldBlock: () => boolean; busy: boolean; discard: () => void }) {
  const blocker = useNavigationBlocker(shouldBlock, busy);
  useEffect(() => { if (busy && blocker.state === "blocked") blocker.reset(); }, [busy, blocker]);
  return <ConfirmDialog open={!busy && blocker.state === "blocked"} title="변경을 버릴까요?" message="저장하지 않은 내용이 사라집니다." confirmLabel="변경 버리기"
    onConfirm={() => { if (blocker.state === "blocked") { discard(); blocker.proceed(); } }}
    onCancel={() => { if (blocker.state === "blocked") blocker.reset(); }}/>
}

export function BusyNavigationGuard({pending}: {pending: RefObject<boolean>}) {
  const shouldBlock = useCallback(() => pending.current, [pending]);
  const blocker = useNavigationBlocker(shouldBlock, () => pending.current);
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

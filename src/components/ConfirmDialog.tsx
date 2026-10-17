import { type ReactNode, type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";
import { firstField, registerSurface } from "../lib/surface-dom.ts";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "./ui/alert-dialog.tsx";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog.tsx";
import { Button } from "./ui/button.tsx";
import { XIcon } from "lucide-react";

interface ConfirmProps {
  open: boolean; title: string; message: ReactNode; confirmLabel: string; danger?: boolean;
  busy?: boolean; confirmDisabled?: boolean; onConfirm: () => void; onCancel: () => void;
}

export function ConfirmDialog({ open, title, message, confirmLabel, danger, busy = false, confirmDisabled = false, onConfirm, onCancel }: ConfirmProps) {
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const origin = useRef<HTMLElement | null>(null);
  const heading = useRef<HTMLHeadingElement>(null), footer = useRef<HTMLDivElement>(null);
  const elements = useRef({ title, body: root, heading: heading.current, footer: footer.current, active: open, modal: true, confirmation: true, ready: true });
  useLayoutEffect(() => { elements.current = { title, body: root, heading: heading.current, footer: footer.current, active: open, modal: true, confirmation: true, ready: true }; });
  useLayoutEffect(() => root ? registerSurface(root, () => elements.current) : undefined, [root, open]);
  return <AlertDialog open={open} onOpenChange={next => { if (!next && !busy) onCancel(); }}>
    <AlertDialogContent ref={setRoot} aria-modal={true}
      onOpenAutoFocus={() => { origin.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; }}
      onCloseAutoFocus={event => { event.preventDefault(); if (origin.current?.isConnected) origin.current.focus(); }}
      onEscapeKeyDown={event => { if (busy) event.preventDefault(); }}>
      <AlertDialogHeader><AlertDialogTitle ref={heading}>{title}</AlertDialogTitle><AlertDialogDescription asChild><div>{message}</div></AlertDialogDescription></AlertDialogHeader>
      <AlertDialogFooter ref={footer}>
        <AlertDialogCancel disabled={busy} onClick={event => { event.preventDefault(); if (!busy) onCancel(); }}>취소</AlertDialogCancel>
        <AlertDialogAction variant={danger ? "destructive" : "default"} disabled={busy || confirmDisabled} onClick={event => { event.preventDefault(); if (!busy && !confirmDisabled) onConfirm(); }}>{busy ? "처리 중…" : confirmLabel}</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
}

/** Editable execution details use Dialog; simple discard choices use AlertDialog above. */
export function ConfirmationSurface({ open, title, busy = false, onCancel, footer, children, closeButton = false }: {
  open: boolean; title: string; busy?: boolean; onCancel: () => void; footer: ReactNode; children: ReactNode; closeButton?: boolean;
}) {
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const origin = useRef<HTMLElement | null>(null);
  const body = useRef<HTMLDivElement>(null), heading = useRef<HTMLHeadingElement>(null), footerElement = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLElement | null>(null); viewportRef.current = root;
  useSurfaceViewport(viewportRef, root);
  const elements = useRef({ title, body: body.current, heading: heading.current, footer: footerElement.current, active: open, modal: true, confirmation: true, ready: true });
  useLayoutEffect(() => { elements.current = { title, body: body.current, heading: heading.current, footer: footerElement.current, active: open, modal: true, confirmation: true, ready: true }; });
  useLayoutEffect(() => root ? registerSurface(root, () => elements.current) : undefined, [root, open]);
  const cancel = () => { if (!busy) onCancel(); };
  return <Dialog open={open} onOpenChange={next => { if (!next) cancel(); }}>
    <DialogContent ref={setRoot} aria-modal={true} showCloseButton={false} aria-describedby={undefined}
      className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg"
      style={{ maxHeight: "calc(var(--surface-height, 100dvh) - 1rem)" }}
      onOpenAutoFocus={event => {
        origin.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const field = firstField(body.current);
        if (field) { event.preventDefault(); field.focus(); }
      }}
      onCloseAutoFocus={event => { event.preventDefault(); if (origin.current?.isConnected) origin.current.focus(); }}
      onPointerDownOutside={event => event.preventDefault()} onInteractOutside={event => event.preventDefault()}
      onEscapeKeyDown={event => { event.preventDefault(); event.stopPropagation(); cancel(); }}>
      <DialogHeader className="shrink-0 p-4"><div className="flex min-w-0 items-center gap-2"><DialogTitle ref={heading} className="min-w-0 flex-1 break-words">{title}</DialogTitle>
        {closeButton && <Button type="button" variant="ghost" size="icon" aria-label="닫기" disabled={busy} onClick={cancel}><XIcon /></Button>}
      </div></DialogHeader>
      <div ref={body} className="min-h-0 overflow-y-auto overscroll-contain px-4 pb-4">{children}</div>
      <DialogFooter ref={footerElement} className="m-0 shrink-0">{footer}</DialogFooter>
    </DialogContent>
  </Dialog>;
}

export function useSurfaceViewport(ref: RefObject<HTMLElement | null>, element?: HTMLElement | null) {
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
  }, [ref, element]);
}

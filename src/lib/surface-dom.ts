/** DOM ownership only. Owners retain open state, route guards and primitive lifecycles. */
export interface SurfaceElements {
  title: string;
  body: HTMLElement | null;
  heading: HTMLElement | null;
  footer: HTMLElement | null;
  active: boolean;
  modal: boolean;
  confirmation: boolean;
  ready: boolean;
}
export interface OwnedSurface extends SurfaceElements { root: HTMLElement }
const surfaces = new Map<HTMLElement, () => SurfaceElements>();
const scrollOwners = new Map<HTMLElement, () => boolean>();

export function registerSurface(root: HTMLElement, read: () => SurfaceElements) {
  surfaces.set(root, read);
  return () => { surfaces.delete(root); };
}
export function registerScrollOwner(root: HTMLElement, enabled: () => boolean) {
  scrollOwners.set(root, enabled);
  return () => { scrollOwners.delete(root); };
}
export function surfaceFor(node: Node | null): OwnedSurface | null {
  for (let element = node instanceof Element ? node : node?.parentElement; element; element = element.parentElement) {
    const read = surfaces.get(element as HTMLElement);
    if (read) return { root: element as HTMLElement, ...read() };
  }
  return null;
}
export function activeSurface(confirmation?: boolean): OwnedSurface | null {
  const active = [...surfaces].filter(([root, read]) => root.isConnected && read().active)
    .map(([root, read]) => ({ root, ...read() }));
  if (confirmation !== undefined) return active.filter(surface => surface.confirmation === confirmation).at(-1) ?? null;
  return active.filter(surface => surface.confirmation).at(-1) ?? active.at(-1) ?? null;
}
export function hasActiveConfirmation() { return !!activeSurface(true); }
export function isInActiveSurface(node: Node | null) { return !!surfaceFor(node)?.active; }
/** A detail body takes precedence over the split list. null means the page scrolls. */
export function scrollOwner(node: Node | null): HTMLElement | null {
  const surface = surfaceFor(node);
  if (surface?.active && surface.body?.contains(node)) return surface.body;
  for (let element = node instanceof Element ? node : node?.parentElement; element; element = element.parentElement) {
    if (scrollOwners.get(element as HTMLElement)?.()) return element as HTMLElement;
  }
  return null;
}
export function scrollTop(node: Node | null) { return scrollOwner(node)?.scrollTop ?? window.scrollY; }
export function restoreScroll(node: Node | null, top: number) {
  const owner = scrollOwner(node);
  if (owner) owner.scrollTop = top; else window.scrollTo(0, top);
}
export function shiftScroll(node: Node | null, delta: number) {
  const owner = scrollOwner(node);
  if (owner) owner.scrollTop += delta; else window.scrollBy(0, delta);
}

/** Field marks its actual control so custom select triggers participate in initial focus. */
export function firstField(root: ParentNode | null): HTMLElement | null {
  return root?.querySelector<HTMLElement>("[aria-invalid='true']:not(:disabled):not([aria-disabled='true'])")
    ?? root?.querySelector<HTMLElement>("[data-field-control]:not(:disabled):not([aria-disabled='true'])") ?? null;
}

/** Resolve ephemeral menu items through their official ARIA relationship to a durable trigger. */
export function durableFocusTarget(node: Element | null): HTMLElement | null {
  const menu = node?.closest('[role="menu"]');
  const trigger = menu?.getAttribute("aria-labelledby")?.split(/\s+/)
    .map(id => menu.ownerDocument.getElementById(id))
    .find(element => element instanceof HTMLElement && element.getAttribute("aria-haspopup") === "menu");
  return trigger instanceof HTMLElement ? trigger : node instanceof HTMLElement ? node : null;
}

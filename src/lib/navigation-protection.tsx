import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
} from "react";
import { type Blocker, type BlockerFunction, useBlocker } from "react-router";

type Protection = { blocks: BlockerFunction; busy: () => boolean; priority: number };
const idle: Blocker = { state: "unblocked", proceed: undefined, reset: undefined, location: undefined };
const Context = createContext<
  {
    register: (id: string, protection: Protection) => () => void;
    owner: string | null;
    blocker: Blocker;
    isBusy: () => boolean;
  } | null
>(null);

/** React Router has one blocker; the two panes contribute protections without replacing each other. */
export function NavigationProtection({ children }: { children: ReactNode }) {
  const protections = useRef(new Map<string, Protection>());
  const pending = useRef<{ owner: string | null; matches: Protection[] }>({ owner: null, matches: [] });
  const register = useCallback((id: string, protection: Protection) => {
    protections.current.set(id, protection);
    return () => {
      protections.current.delete(id);
    };
  }, []);
  const isBusy = useCallback(() => [...protections.current.values()].some((protection) => protection.busy()), []);
  const blocker = useBlocker((transition) => {
    const matches = [...protections.current].filter(([, protection]) => protection.blocks(transition));
    matches.sort((a, b) => b[1].priority - a[1].priority);
    pending.current = { owner: matches[0]?.[0] ?? null, matches: matches.map(([, protection]) => protection) };
    return matches.length > 0;
  });
  const busy = blocker.state === "blocked" && pending.current.matches.some((protection) => protection.busy());
  useEffect(() => {
    if (blocker.state === "blocked" && (busy || !protections.current.has(pending.current.owner ?? ""))) blocker.reset();
  }, [blocker, busy]);
  return (
    <Context.Provider value={{ register, owner: busy ? null : pending.current.owner, blocker, isBusy }}>
      {children}
    </Context.Provider>
  );
}

/** Keep each screen's existing confirmation while combining every pending write before navigation. */
export function useNavigationBlocker(
  when: boolean | BlockerFunction,
  busy: boolean | (() => boolean) = false,
  priority = 0,
): Blocker {
  const context = useContext(Context);
  const id = useId();
  const latest = useRef({ when, busy, priority });
  latest.current = { when, busy, priority };
  if (!context) throw new Error("Navigation protection requires NavigationProtection.");
  const { register } = context;
  useLayoutEffect(() =>
    register(id, {
      blocks: (transition) =>
        typeof latest.current.when === "function" ? latest.current.when(transition) : latest.current.when,
      busy: () => typeof latest.current.busy === "function" ? latest.current.busy() : latest.current.busy,
      get priority() {
        return latest.current.priority;
      },
    }), [id, register]);
  return context.owner === id ? context.blocker : idle;
}

export function useNavigationBusy() {
  const context = useContext(Context);
  if (!context) throw new Error("Navigation protection requires NavigationProtection.");
  return context.isBusy;
}

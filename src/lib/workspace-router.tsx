/** Business screens use space-relative paths; browser URLs always retain their explicit space. */
import { forwardRef, useCallback, useMemo, useRef } from "react";
import {
  type BlockerFunction,
  createSearchParams,
  type SetURLSearchParams,
  type URLSearchParamsInit,
  Link as RouterLink,
  type LinkProps,
  Navigate as RouterNavigate,
  type NavigateFunction,
  type NavigateOptions,
  type NavigateProps,
  type To,
  parsePath,
  useBlocker as routerBlocker,
  useLocation as routerLocation,
  useNavigate as routerNavigate,
} from "react-router";
import {
  businessPath,
  useWorkspaceId,
  useWorkspacePathPrefix,
  workspacePath,
} from "./workspace-route.tsx";
export * from "react-router";
function scoped(to: To, workspaceId: string | null, pathname: string): To {
  const prefix = (path: string) =>
    workspaceId &&
      /^\/(?:entities|tasks|records|search|status|tags|guide|settings)(?:[/?#]|$)/
        .test(path)
      ? workspacePath(workspaceId, path)
      : path;
  // Descendant Routes render virtual business paths, so query/hash-only resolution needs its space too.
  if (workspaceId && (typeof to === "string" ? !to || /^[?#]/.test(to) : to.pathname == null || to.pathname === "")) {
    return { ...(typeof to === "string" ? parsePath(to) : to), pathname: prefix(pathname) };
  }
  return typeof to === "string"
    ? prefix(to)
    : to.pathname
    ? { ...to, pathname: prefix(to.pathname) }
    : to;
}
export function useLocation() {
  const location = routerLocation(), id = useWorkspaceId();
  return useMemo(
    () =>
      id
        ? { ...location, pathname: businessPath(location.pathname) }
        : location,
    [location, id],
  );
}
export function useNavigate(): NavigateFunction {
  const navigate = routerNavigate(),
    { pathname } = routerLocation(),
    workspaceId = useWorkspaceId(),
    prefix = useWorkspacePathPrefix(),
    id = prefix ? workspaceId : null;
  return useCallback(
    ((to: To | number, options?: NavigateOptions) =>
      typeof to === "number"
        ? navigate(to)
        : navigate(scoped(to, id, pathname), options)) as NavigateFunction,
    [navigate, id, pathname],
  );
}
/** Query-only navigation must keep the current business path's explicit workspace. */
export function useSearchParams(defaultInit?: URLSearchParamsInit): [URLSearchParams, SetURLSearchParams] {
  const defaults = useRef(createSearchParams(defaultInit)), changed = useRef(false);
  const location = useLocation(), navigate = useNavigate();
  const params = useMemo(() => {
    const next = createSearchParams(location.search);
    if (!changed.current) {
      defaults.current.forEach((_, key) => {
        if (!next.has(key)) {
          for (const value of defaults.current.getAll(key)) next.append(key, value);
        }
      });
    }
    return next;
  }, [location.search]);
  const setParams = useCallback<SetURLSearchParams>((nextInit, options) => {
    const next = createSearchParams(typeof nextInit === "function" ? nextInit(new URLSearchParams(params)) : nextInit);
    changed.current = true;
    void navigate({ pathname: location.pathname, search: `?${next}` }, options);
  }, [navigate, location.pathname, params]);
  return [params, setParams];
}
export const Link = forwardRef<HTMLAnchorElement, LinkProps>(
  function Link(props, ref) {
    const { pathname } = routerLocation(), workspaceId = useWorkspaceId(),
      prefix = useWorkspacePathPrefix(),
      id = prefix ? workspaceId : null;
    return <RouterLink {...props} ref={ref} to={scoped(props.to, id, pathname)} />;
  },
);
export function Navigate(props: NavigateProps) {
  const { pathname } = routerLocation(), workspaceId = useWorkspaceId(),
    prefix = useWorkspacePathPrefix(),
    id = prefix ? workspaceId : null;
  return <RouterNavigate {...props} to={scoped(props.to, id, pathname)} />;
}
export function useBlocker(when: boolean | BlockerFunction) {
  const id = useWorkspaceId();
  return routerBlocker(
    typeof when === "function"
      ? (transition) => {
        const normalize = (location: typeof transition.currentLocation) =>
          id && location.pathname.startsWith(`/w/${id}/`)
            ? { ...location, pathname: businessPath(location.pathname) }
            : location;
        return when({
          ...transition,
          currentLocation: normalize(transition.currentLocation),
          nextLocation: normalize(transition.nextLocation),
        });
      }
      : when,
  );
}

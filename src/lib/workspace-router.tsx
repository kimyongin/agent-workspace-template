/** Business screens use space-relative paths; browser URLs always retain their explicit space. */
import { forwardRef, useCallback, useMemo } from "react";
import {
  type BlockerFunction,
  Link as RouterLink,
  type LinkProps,
  Navigate as RouterNavigate,
  type NavigateFunction,
  type NavigateOptions,
  type NavigateProps,
  type To,
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
function scoped(to: To, workspaceId: string | null): To {
  const prefix = (path: string) =>
    workspaceId &&
      /^\/(?:entities|tasks|records|search|status|tags|guide|settings)(?:[/?#]|$)/
        .test(path)
      ? workspacePath(workspaceId, path)
      : path;
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
    workspaceId = useWorkspaceId(),
    prefix = useWorkspacePathPrefix(),
    id = prefix ? workspaceId : null;
  return useCallback(
    ((to: To | number, options?: NavigateOptions) =>
      typeof to === "number"
        ? navigate(to)
        : navigate(scoped(to, id), options)) as NavigateFunction,
    [navigate, id],
  );
}
export const Link = forwardRef<HTMLAnchorElement, LinkProps>(
  function Link(props, ref) {
    const workspaceId = useWorkspaceId(),
      prefix = useWorkspacePathPrefix(),
      id = prefix ? workspaceId : null;
    return <RouterLink {...props} ref={ref} to={scoped(props.to, id)} />;
  },
);
export function Navigate(props: NavigateProps) {
  const workspaceId = useWorkspaceId(),
    prefix = useWorkspacePathPrefix(),
    id = prefix ? workspaceId : null;
  return <RouterNavigate {...props} to={scoped(props.to, id)} />;
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

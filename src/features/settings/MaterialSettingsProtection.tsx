import { useNavigationBlocker } from "../../lib/navigation-protection.tsx";
import { useContext, useEffect, useId, useRef } from "react";
import { ConfirmDialog } from "../../components/Modal.tsx";
import { detailIdentity, materialSettingsBase, WorkspaceContext } from "../details/workspace-context.ts";

export function MaterialSettingsProtection(
  props: { dirty: boolean; busy: boolean; typeId?: string; jobId?: string; protectJob?: boolean },
) {
  const workspace = useContext(WorkspaceContext),
    id = useId(),
    latest = useRef(props);
  latest.current = props;
  const allows = (path: string, search?:string) =>
    !!detailIdentity(path) ||
    materialSettingsBase(path) &&
      (path.match(/^\/settings\/(?:entity-types|materials)\/([^/]+)/)?.[1] ??
          undefined) === latest.current.typeId && (!latest.current.protectJob || (path.match(/\/migrations\/([^/]+)$/)?.[1] ?? new URLSearchParams(search).get("job_id") ?? undefined) === latest.current.jobId);
  useEffect(
    () =>
      workspace?.registerGuard(
        id,
        () => ({
          dirty: latest.current.dirty,
          busy: latest.current.busy,
          retained: true,
          discard: () => {},
          allows,
        }),
      ),
    [workspace?.registerGuard, id],
  );
  return workspace ? null : <LocalProtection {...props} allows={allows} />;
}
function LocalProtection(
  { dirty, busy, allows }: {
    dirty: boolean;
    busy: boolean;
    allows: (path: string, search?:string) => boolean;
  },
) {
  const blocker = useNavigationBlocker(({ nextLocation }) => (busy || dirty && !allows(nextLocation.pathname,nextLocation.search)), busy);
  useEffect(() => {
    if (busy && blocker.state === "blocked") blocker.reset();
  }, [busy, blocker]);
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => {
      if (dirty || busy) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", unload);
    return () => window.removeEventListener("beforeunload", unload);
  }, [dirty, busy]);
  return (
    <ConfirmDialog
      open={!busy && blocker.state === "blocked"}
      title="변경을 버릴까요?"
      message="저장하지 않은 설정이 사라집니다."
      confirmLabel="이동"
      onConfirm={() => {
        if (blocker.state === "blocked") blocker.proceed();
      }}
      onCancel={() => {
        if (blocker.state === "blocked") blocker.reset();
      }}
    />
  );
}

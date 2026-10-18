import { Link, Navigate } from "react-router";
import { useWorkspaceCapabilities } from "./workspace-context.tsx";
import { useWorkspaceId, workspacePath } from "../../lib/workspace-route.tsx";
import { Button } from "../../components/ui/button.tsx";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "../../components/ui/empty.tsx";

/** The gate supplies current server capabilities; choosing a start page grants nothing. */
export function WorkspaceLanding() {
  const capability = useWorkspaceCapabilities(), id = useWorkspaceId();
  if (!capability || !id) return null;
  const allowed = (kind: "tasks" | "settings") =>
    capability.grants.some((grant) =>
      grant.target_kind === kind && (grant.access === "read" || grant.access === "write")
    );
  const kind = capability.grants.find((grant) =>
    grant.target_kind === "entity_type" && (grant.access === "read" || grant.access === "write")
  );
  const path = allowed("tasks")
    ? "/tasks"
    : kind
    ? `/entities?entity_type_id=${encodeURIComponent(kind.target_id)}`
    : capability.can_manage
    ? "/manage"
    : allowed("settings")
    ? "/settings/data-model"
    : null;
  if (path) return <Navigate to={workspacePath(id, path)} replace />;
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>
          <h1>열 수 있는 업무가 없습니다</h1>
        </EmptyTitle>
        <EmptyDescription>
          이 공간에 참여 중이지만 자료·할 일·설정 접근 권한이 없습니다. 관리자에게 필요한 권한을 요청하세요.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent className="flex flex-wrap gap-2">
        <Button asChild>
          <Link to="/workspaces">내 공간 목록</Link>
        </Button>
        <Button asChild variant="outline">
          <Link to={`/workspaces?leave=${encodeURIComponent(id)}`}>참여 확인·탈퇴</Link>
        </Button>
      </EmptyContent>
    </Empty>
  );
}

import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";

/** A safe sibling of retained protected content; never replaces its draft owner. */
export function WorkspacePermissionNotice() {
  return (
    <Empty role="status">
      <EmptyHeader>
        <EmptyTitle role="heading" aria-level={2}>이 내용을 읽을 권한이 없습니다.</EmptyTitle>
        <EmptyDescription>공간 관리자에게 권한을 확인하거나 다른 공간을 선택하세요.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button asChild variant="outline"><Link to="/workspaces">공간 목록</Link></Button>
      </EmptyContent>
    </Empty>
  );
}

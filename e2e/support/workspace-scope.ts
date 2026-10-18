import type { Route } from "@playwright/test";
import type { WorkspaceGrant } from "../../supabase/functions/_shared/contracts/workspace.ts";
import { workspacePath } from "../../src/lib/workspace-route.tsx";
/** Explicit tenant used by the older isolated screen fixtures. */
export const fixtureWorkspaceId = "00000000-0000-4000-8000-000000000980";

/** Real App fixtures select this explicit mock workspace; isolated routers keep their own paths. */
export const fixtureWorkspacePath = (path: string) => workspacePath(fixtureWorkspaceId, path);


/** Standalone real-App mocks declare their exact grants; this handles only current workspace control reads. */
export async function fulfillFixtureWorkspace(route: Route, grants: WorkspaceGrant[]): Promise<boolean> {
  const { pathname } = new URL(route.request().url());
  if (!pathname.startsWith("/api/workspaces")) {
    if (/^\/api\/(?:entities|entity-types|entity-schema-migrations|entity-relation-definitions|entity-identity|tasks|records|tags|tag-connections|status|search|settings|data-model)(?:\/|$)/.test(pathname) &&
      route.request().headers()["x-workspace-id"] !== fixtureWorkspaceId) {
      await route.fulfill({ status: 400, json: { code: "invalid_input", message: "fixture 공간 문맥이 필요합니다" } });
      return true;
    }
    return false;
  }
  const workspace = { id: fixtureWorkspaceId, name: "테스트 공간", deleted_at: null };
  if (route.request().method() !== "GET") {
    await route.fulfill({ status: 400, json: { code: "invalid_input", message: "지원하지 않는 fixture 공간 쓰기" } });
  } else if (pathname === "/api/workspaces") {
    await route.fulfill({ json: { items: [{ ...workspace, can_manage: true }] } });
  } else if (pathname === "/api/workspaces/deleted") {
    await route.fulfill({ json: { items: [] } });
  } else if (pathname === `/api/workspaces/${fixtureWorkspaceId}`) {
    await route.fulfill({ json: { workspace, can_manage: true, membership_version: 1, grants } });
  } else if (pathname === `/api/workspaces/${fixtureWorkspaceId}/membership`) {
    await route.fulfill({ json: { workspace, membership_version: 1 } });
  } else if (pathname === `/api/workspaces/${fixtureWorkspaceId}/lifecycle`) {
    await route.fulfill({ json: { workspace: { ...workspace, lifecycle_generation: 1 } } });
  } else {
    await route.fulfill({ status: 404, json: { code: "not_found", message: "fixture 공간을 찾을 수 없습니다" } });
  }
  return true;
}

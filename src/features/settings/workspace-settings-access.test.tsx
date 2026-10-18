import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import type { WorkspaceCapabilities } from "@contracts/workspace.ts";
import type { EntitySchemaMigration } from "@contracts/entity-schema-migration.ts";
import { WorkspaceSettingsBoundary } from "./workspace-settings-access.tsx";
import { MigrationStart } from "./SchemaMigrationJobs.tsx";
import type { EntitySchemaChange } from "@contracts/entity-schema-change.ts";
import { RecoveryChangeCreate } from "./SchemaRecovery.tsx";

const capability = vi.hoisted(() => ({ current: null as WorkspaceCapabilities | null }));
vi.mock("../workspaces/workspace-context.tsx", () => ({ useWorkspaceCapabilities: () => capability.current }));
vi.mock("../../lib/api.ts", () => ({ createScopedApi: () => vi.fn() }));
const job = { id: "job", type_id: "kind", status: "succeeded", version: 1,
  source_expires_at: "2026-11-01T00:00:00Z", recovery: { status: "available", current_schema_version: 2 } } as EntitySchemaMigration;
function showRecovery(access: "none" | "read" | "write") {
  capability.current = { workspace: { id: "space", name: "공유 공간", deleted_at: null },
    grants: [{ target_kind: "settings", target_id: "*", access }], can_manage: access === "write", membership_version: 1 };
  return renderToStaticMarkup(<MemoryRouter><RecoveryChangeCreate job={job} /></MemoryRouter>);
}
it("설정 읽기 사용자는 복구 상태와 분석 경로를 보되 복구안을 만들 수 없다", () => {
  const html = showRecovery("read");
  expect(html).toContain("복구안 생성 가능");
  expect(html).toContain("/settings/entity-types/kind");
  expect(html).toMatch(/<button[^>]*disabled=""[^>]*>원본 복구안 만들기<\/button>/);
});

it("읽기 권한은 값 변환 접수를 허용하지 않고 쓰기 권한은 접수를 허용한다", () => {
  const plan = { id: "change", type_id: "kind", executable: true } as EntitySchemaChange;
  showRecovery("read");
  const read = renderToStaticMarkup(<MemoryRouter><MigrationStart plan={plan} disabled={false} /></MemoryRouter>);
  expect(read).toMatch(/<button[^>]*disabled=""[^>]*>값 변환 시작<\/button>/);
  showRecovery("write");
  const write = renderToStaticMarkup(<MemoryRouter><MigrationStart plan={plan} disabled={false} /></MemoryRouter>);
  expect(write).not.toContain('disabled=""');
});
it("설정 권한이 없으면 하위 설정 독자를 마운트하지 않고 읽기 권한이면 안내와 내용을 보여 준다", () => {
  function SettingsReader() { return <p>현재 자료 정의</p>; }
  showRecovery("none");
  const denied = renderToStaticMarkup(<WorkspaceSettingsBoundary><SettingsReader /></WorkspaceSettingsBoundary>);
  expect(denied).toContain("설정 조회 권한이 필요합니다");
  expect(denied).not.toContain("현재 자료 정의");
  showRecovery("read");
  const read = renderToStaticMarkup(<WorkspaceSettingsBoundary><SettingsReader /></WorkspaceSettingsBoundary>);
  expect(read).toContain("읽기 전용 설정");
  expect(read).toContain("현재 자료 정의");
});

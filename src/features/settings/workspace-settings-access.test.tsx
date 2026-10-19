import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { WorkspaceCapabilitiesContext } from "../workspaces/workspace-context.tsx";
import { MemoryRouter } from "react-router";
import type { WorkspaceCapabilities } from "@contracts/workspace.ts";
import type { EntitySchemaMigration } from "@contracts/entity-schema-migration.ts";
import { WorkspaceSettingsBoundary } from "./workspace-settings-access.tsx";
import { IssuerRegistryEditor } from "./IssuerRegistryEditor.tsx";
import { RecoveryChangeCreate } from "./SchemaRecovery.tsx";

const capability: { current: WorkspaceCapabilities | null } = { current: null };
const job = {
  id: "job",
  type_id: "kind",
  status: "succeeded",
  version: 1,
  source_expires_at: "2026-11-01T00:00:00Z",
  recovery: { status: "available", current_schema_version: 2 },
} as EntitySchemaMigration;
function showRecovery(access: "none" | "read" | "write") {
  capability.current = {
    workspace: { id: "space", name: "공유 공간", deleted_at: null },
    grants: [{ target_kind: "settings", target_id: "*", access }],
    can_manage: access === "write",
    membership_version: 1,
  };
  return renderToStaticMarkup(
    <WorkspaceCapabilitiesContext.Provider value={capability.current}>
      <MemoryRouter>
        <RecoveryChangeCreate job={job} />
      </MemoryRouter>
    </WorkspaceCapabilitiesContext.Provider>,
  );
}
it("설정 읽기 사용자는 복구 상태와 분석 경로를 보되 복구안을 만들 수 없다", () => {
  const html = showRecovery("read");
  expect(html).toContain("복구안 생성 가능");
  expect(html).toContain("/settings/entity-types/kind");
  expect(html).toMatch(/<button[^>]*disabled=""[^>]*>원본 복구안 만들기<\/button>/);
});

it("설정 권한이 없으면 하위 설정 독자를 마운트하지 않고 읽기 권한이면 안내와 내용을 보여 준다", () => {
  function SettingsReader() {
    return <p>현재 자료 정의</p>;
  }
  showRecovery("none");
  const denied = renderToStaticMarkup(
    <WorkspaceCapabilitiesContext.Provider value={capability.current}>
      <WorkspaceSettingsBoundary>
        <SettingsReader />
      </WorkspaceSettingsBoundary>
    </WorkspaceCapabilitiesContext.Provider>,
  );
  expect(denied).toContain("설정 조회 권한이 필요합니다");
  expect(denied).not.toContain("현재 자료 정의");
  showRecovery("read");
  const read = renderToStaticMarkup(
    <WorkspaceCapabilitiesContext.Provider value={capability.current}>
      <WorkspaceSettingsBoundary>
        <SettingsReader />
      </WorkspaceSettingsBoundary>
    </WorkspaceCapabilitiesContext.Provider>,
  );
  expect(read).toContain("읽기 전용 설정");
  expect(read).toContain("현재 자료 정의");
});

it("읽기 전용 번호 종류는 저장된 의미를 보여 주되 입력과 저장은 허용하지 않는다", () => {
  showRecovery("read");
  const html = renderToStaticMarkup(
    <WorkspaceCapabilitiesContext.Provider value={capability.current}>
      <IssuerRegistryEditor
        inline
        target={{
          kind: "rule",
          source: "store",
          sourceLabel: "판매처",
          rule: {
            id: "rule",
            source: "store",
            label: "상품 번호",
            meaning: "판매처에 등록된 고유 상품 번호",
            active: true,
            generation: "direct",
            version: 1,
          },
        }}
        onClose={() => {}}
        onSaved={() => {}}
      />
    </WorkspaceCapabilitiesContext.Provider>,
  );
  expect(html).toContain("판매처에 등록된 고유 상품 번호");
  expect(html).toMatch(/<fieldset[^>]*disabled=""/);
  expect(html).toMatch(/<button[^>]*disabled=""[^>]*>저장<\/button>/);
});

import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import type { TaskResult } from "@contracts/task.ts";
import type { EntityDetail } from "@contracts/entity.ts";
import type { WorkspaceCapabilities } from "@contracts/workspace.ts";
import { WorkspaceCapabilitiesContext } from "../workspaces/workspace-context.tsx";
import { EntityTaskRelations, TaskEntityRelations } from "../entity/TaskEntityRelations.tsx";

vi.mock("../../lib/api.ts", () => ({ createScopedApi: () => vi.fn(), ApiError: Error }));

const entity = { id: "entity", title: "공유 자료", entity_type_id: "type", tasks: { count: 0, items: [] } } as unknown as EntityDetail;
const read = { items: [], loading: false, failed: false, more: () => {}, canReadMore: false };
function render(grants: WorkspaceCapabilities["grants"]) {
  return renderToStaticMarkup(
    <MemoryRouter>
      <WorkspaceCapabilitiesContext.Provider value={{ grants } as WorkspaceCapabilities}>
        <EntityTaskRelations entity={entity} read={read} onCreate={() => {}} />
      </WorkspaceCapabilitiesContext.Provider>
    </MemoryRouter>,
  );
}
it.each(["read", "write"] as const)("kind %s alone cannot create or link tasks", access => {
  const html = render([{ target_kind: "entity_type", target_id: "type", access }]);
  expect(html).not.toContain('aria-label="할 일 작성"');
  expect(html).not.toContain('aria-label="할 일 연결"');
});
it("task READ keeps associations viewable without mutation actions", () => {
  const html = render([{ target_kind: "tasks", target_id: "*", access: "read" }, { target_kind: "entity_type", target_id: "type", access: "read" }]);
  expect(html).toContain("할 일");
  expect(html).not.toContain('aria-label="할 일 작성"');
  expect(html).not.toContain('aria-label="할 일 연결"');
});
it("task WRITE admits creation and linking", () => {
  const html = render([{ target_kind: "tasks", target_id: "*", access: "write" }, { target_kind: "entity_type", target_id: "type", access: "read" }]);
  expect(html).toContain('aria-label="할 일 작성"');
  expect(html).toContain('aria-label="할 일 연결"');
});

it("revoked material READ conceals cached task associations and counts", () => {
  const task = { id: "task", entity_ids: ["secret"], entity_context: [{ id: "secret", title: "보호된 이름", type: { id: "type", label: "종류", icon_id: "file", archived: false } }] } as unknown as TaskResult;
  const html = renderToStaticMarkup(<MemoryRouter><WorkspaceCapabilitiesContext.Provider value={{ grants: [{ target_kind: "tasks", target_id: "*", access: "write" }] } as WorkspaceCapabilities}><TaskEntityRelations task={task} readOnly onSaved={() => {}} /></WorkspaceCapabilitiesContext.Provider></MemoryRouter>);
  expect(html).not.toContain("보호된 이름");
  expect(html).not.toContain("연결된 자료가 없습니다.");
  expect(html).not.toContain("연결된 자료 (0개)");
});

it("read-only empty associations do not suggest unavailable actions", () => {
  const html = render([{ target_kind: "tasks", target_id: "*", access: "read" }, { target_kind: "entity_type", target_id: "type", access: "read" }]);
  expect(html).toContain("연결된 할 일이 없습니다.");
  expect(html).not.toContain("작성하거나 연결해");
});
it("a failed relation read is not reported as empty", () => {
  const html = renderToStaticMarkup(<MemoryRouter><WorkspaceCapabilitiesContext.Provider value={{ grants: [
    { target_kind: "tasks", target_id: "*", access: "read" }, { target_kind: "entity_type", target_id: "type", access: "read" },
  ] } as WorkspaceCapabilities}><EntityTaskRelations entity={entity} read={{ ...read, failed: true }} /></WorkspaceCapabilitiesContext.Provider></MemoryRouter>);
  expect(html).toContain("연결된 할 일을 불러오지 못했습니다.");
  expect(html).not.toContain("연결된 할 일이 없습니다.");
});


it("unreadable existing material links do not remove an authorized new connection", () => {
  const task = { id: "task", entity_ids: ["secret"], entity_context: [{ id: "secret", title: "보호된 이름", type: { id: "secret-type", label: "보호된 종류", icon_id: "file", archived: false } }] } as unknown as TaskResult;
  const html = renderToStaticMarkup(<MemoryRouter><WorkspaceCapabilitiesContext.Provider value={{ grants: [
    { target_kind: "tasks", target_id: "*", access: "write" },
    { target_kind: "entity_type", target_id: "other-type", access: "read" },
  ] } as WorkspaceCapabilities}><TaskEntityRelations task={task} onSaved={() => {}} /></WorkspaceCapabilitiesContext.Provider></MemoryRouter>);
  expect(html).toContain('aria-label="자료 연결"');
  expect(html).toContain("연결된 자료를 조회할 수 없습니다.");
  expect(html).not.toContain("보호된 이름");
  expect(html).not.toContain("연결된 자료가 없습니다.");
  expect(html).not.toContain("연결된 자료 (0개)");
});

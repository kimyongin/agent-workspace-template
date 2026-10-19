import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { WorkspaceCapabilities } from "@contracts/workspace.ts";
import { WorkspaceCapabilitiesContext } from "../workspaces/workspace-context.tsx";
import { TaskDetailPage } from "./TaskDetailPage.tsx";

const state = vi.hoisted(() => ({ task: {} as Record<string, unknown> }));
vi.mock("../../lib/api-context.tsx", () => ({ useApi: () => vi.fn() }));
vi.mock("../../lib/workspace-router.tsx", () => ({
  useLocation: () => ({ key: "detail" }),
  useParams: () => ({ id: "task" }),
  useSearchParams: () => [new URLSearchParams()],
}));
vi.mock("../../lib/detail-exploration.tsx", () => ({
  useDetailOwnerReturn: () => "/tasks",
  useDetailDeleteReturn: () => "/tasks",
  useDetailNavigate: () => vi.fn(),
}));
vi.mock("../../lib/useDeferredNavigation.ts", () => ({ useDeferredNavigation: () => vi.fn() }));
vi.mock("../../lib/useDisplayTime.ts", () => ({ useDisplayTime: () => ({ timezone: "UTC" }) }));
vi.mock("../details/useDetailResource.ts", () => ({
  useDetailResource: () => ({ value: state.task, loading: false, editReady: true }),
}));
vi.mock("../details/useDetailEditor.ts", () => ({
  useDetailEditor: () => ({ active: false, start: vi.fn() }),
}));
vi.mock("../../components/Modal.tsx", () => ({
  DetailSurface: ({ footer }: { footer: ReactNode }) => <footer>{footer}</footer>,
}));
vi.mock("./TaskDataFields.tsx", () => ({ TaskDataFields: () => null }));
vi.mock("../tags/TagConnections.tsx", () => ({ TagConnections: () => null }));
vi.mock("../entity/TaskEntityRelations.tsx", () => ({ TaskEntityRelations: () => null }));
vi.mock("./RelatedRecords.tsx", () => ({ RelatedRecords: () => null }));

function footer(access: "read" | "write", kind: "once" | "recurring", deleted: boolean, status?: string) {
  state.task = { id: "task", title: "계획", kind, status: status ?? (kind === "once" ? "open" : "active"), version: 1, deleted_at: deleted ? "2026-10-18T00:00:00Z" : null };
  const capabilities = { grants: [{ target_kind: "tasks", target_id: "*", access }] } as WorkspaceCapabilities;
  return renderToStaticMarkup(<WorkspaceCapabilitiesContext.Provider value={capabilities}><TaskDetailPage /></WorkspaceCapabilitiesContext.Provider>);
}

it.each([
  ["once", false], ["once", true], ["recurring", false], ["recurring", true],
] as const)("task READ renders no mutation controls for %s deleted=%s", (kind, deleted) => {
  expect(footer("read", kind, deleted)).not.toContain("<button");
});
it("task WRITE preserves live completion and recurring transition controls", () => {
  expect(footer("write", "once", false)).toContain("편집");
  expect(footer("write", "once", false)).toContain("완료하고 기록");
  expect(footer("write", "recurring", false)).toContain("중단");
  expect(footer("write", "recurring", false, "stopped")).toContain("재개");
});
it.each(["once", "recurring"] as const)("deleted %s task WRITE offers only restore", kind => {
  const html = footer("write", kind, true);
  expect(html).toContain("복원");
  expect(html).not.toContain("편집");
  expect(html).not.toContain("완료하고 기록");
  expect(html).not.toContain("중단");
  expect(html).not.toContain("재개");
});

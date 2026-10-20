import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { RelationPicker } from "../relations/RelationPicker.tsx";

vi.mock("../../lib/api.ts", () => ({ createScopedApi: () => vi.fn(), ApiError: Error }));
const context = [{ id: "secret", title: "보호된 초안 이름", captured_at: "2026-10-01T00:00:00Z", source: "selection" as const, type: { id: "kind", label: "보호된 종류", icon_id: "file", archived: false } }];
it("task association picker conceals retained selected names and counts when kind READ is absent", () => {
  const html = renderToStaticMarkup(<MemoryRouter><RelationPicker kind="entity" value={["secret"]} context={context} canReadEntityType={() => false} onChange={() => {}} /></MemoryRouter>);
  expect(html).not.toContain("보호된 초안 이름");
  expect(html).not.toContain("보호된 종류");
  expect(html).toContain("자료 (0개)");
  expect(html).not.toContain("연결된 자료가 없습니다.");
});
it("task association picker restores a readable retained selection", () => {
  const html = renderToStaticMarkup(<MemoryRouter><RelationPicker kind="entity" value={["secret"]} context={context} canReadEntityType={() => true} onChange={() => {}} /></MemoryRouter>);
  expect(html).toContain("보호된 초안 이름");
  expect(html).toContain("자료 (1개)");
});

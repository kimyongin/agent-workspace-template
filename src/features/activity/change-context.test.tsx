import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { ChangeContext, type WorkspaceRecord } from "./ChangeContext.tsx";

vi.mock("../../lib/api.ts", () => ({ api: vi.fn(), ApiError: Error }));

it("shows stored historical snapshots, without implying missing snapshots describe historical absence", () => {
  const record = { record_kind: "change", change_note: null, change: { target_kind: "entity", target_id: "target", target_title: "고객", action: "update", source: "http", before: null, after: null } } as WorkspaceRecord;
  const render = (value: WorkspaceRecord) => renderToStaticMarkup(<MemoryRouter><ChangeContext record={value}/></MemoryRouter>);
  expect(render(record)).not.toContain("변경 전");
  expect(render(record)).not.toContain("변경 후");
  const old = { ...record, change: { ...record.change!, before: { prop1: "옛 이름" }, after: { prop1: "새 이름" } } };
  expect(render(old)).toContain("변경 전");
  expect(render(old)).toContain("옛 이름");
  expect(render(old)).toContain("새 이름");
  expect(render({ ...old, change: { ...old.change, before: null } })).toContain("변경 후");
});

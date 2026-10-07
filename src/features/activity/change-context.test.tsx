import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { ChangeContext, PrincipleSnapshots, type WorkspaceRecord } from "./ChangeContext.tsx";

vi.mock("../../lib/api.ts", () => ({ api: vi.fn(), ApiError: Error }));

it("does not display an applied-principle panel for records without historical captures", () => {
  expect(renderToStaticMarkup(<PrincipleSnapshots snapshots={[]}/>)).toBe("");
});

it("reads captured principle text and provenance without linking to a retired historical detail", () => {
  const html = renderToStaticMarkup(<PrincipleSnapshots snapshots={[{ id: "historical-principle", title: "당시 기준", summary: "당시 요약", body: "원래 본문을 그대로 보존", version: 3, saved_at: "2026-10-01T02:03:04Z", status: "inactive", captured_at: "migration" }]}/>);
  expect(html).toContain("원래 본문을 그대로 보존");
  expect(html).not.toContain("historical-principle");
  expect(html).toContain("<summary>당시 기준</summary>");
  expect(html).not.toContain("당시 상태: inactive");
  expect(html).toContain("실제 판단 당시의 본문을 보증하지 않습니다");
  expect(html).not.toContain("href=");
});

it("describes application capture as provenance rather than inventing a capture timestamp", () => {
  const html = renderToStaticMarkup(<PrincipleSnapshots snapshots={[{ id: "historical-principle", title: "적용 기준", summary: "당시 요약", body: "적용 당시 본문", version: 2, saved_at: "2026-10-01T02:03:04Z", status: "active", captured_at: "application" }]}/>);
  expect(html).toContain("업무 적용 시 보존한 본문입니다");
  expect(html).not.toContain("실제 판단 당시의 본문을 보증하지 않습니다");
});

it("shows stored historical snapshots, without implying missing snapshots describe historical absence", () => {
  const stamp="2026-10-01T02:03:04Z";
  const record: WorkspaceRecord = { id:"record", body:"고객 수정",record_kind: "change",occurred_at:stamp,task_id:null,occurrence_on:null,entity_ids:[],entity_context:[],tag_ids:[],applied_principle_snapshots:[],version:1,created_at:stamp,updated_at:stamp,change: { event_id:"event",target_kind: "entity", target_id: "target", target_title: "고객", action: "update", source: "http", before: null, after: null,path:null } };
  const render = (value: WorkspaceRecord) => renderToStaticMarkup(<MemoryRouter><ChangeContext record={value}/></MemoryRouter>);
  expect(render(record)).not.toContain("변경 전");
  expect(render(record)).not.toContain("변경 후");
  const old = { ...record, change: { ...record.change!, before: { prop1: "옛 이름" }, after: { prop1: "새 이름" } } };
  expect(render(old)).toContain("변경 전");
  expect(render(old)).toContain("옛 이름");
  expect(render(old)).toContain("새 이름");
  expect(render({ ...old, change: { ...old.change, before: null } })).toContain("변경 후");
});

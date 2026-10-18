import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { ChangeContext, type WorkspaceRecord } from "./ChangeContext.tsx";

vi.mock("../../lib/api.ts", () => ({ createScopedApi: () => vi.fn(), ApiError: Error }));

it("shows stored historical snapshots, without implying missing snapshots describe historical absence", () => {
  const stamp = "2026-10-01T02:03:04Z";
  const record: WorkspaceRecord = {
    id: "record",
    created_by: null,
    created_by_name: null,
    body: "고객 수정",
    record_kind: "change",
    occurred_at: stamp,
    task_id: null,
    occurrence_on: null,
    entity_id: "target",
    tag_ids: [],
    version: 1,
    created_at: stamp,
    updated_at: stamp,
    change: {
      event_id: "event",
      target_kind: "entity",
      target_id: "target",
      target_title: "고객",
      action: "update",
      source: "http",
      before: null,
      after: null,
      path: null,
    },
  };
  const render = (value: WorkspaceRecord) =>
    renderToStaticMarkup(
      <MemoryRouter>
        <ChangeContext record={value} />
      </MemoryRouter>,
    );
  expect(render(record)).toContain("<dt>변경 대상</dt><dd>자료 「고객」</dd>");
  expect(render(record)).toContain("<dt>행동</dt><dd>수정</dd>");
  expect(render(record)).not.toContain("변경 전");
  expect(render(record)).not.toContain("변경 후");
  const old = { ...record, change: { ...record.change!, before: { prop1: "옛 이름" }, after: { prop1: "새 이름" } } };
  expect(render(old)).toContain("변경 전");
  expect(render(old)).toContain("옛 이름");
  expect(render(old)).toContain("새 이름");
  expect(render({ ...old, change: { ...old.change, before: null } })).toContain("변경 후");
});

it("reads saved changes as labeled values while preserving zero, false, null and unknown historical fields", () => {
  const stamp = "2026-10-01T02:03:04Z";
  const record: WorkspaceRecord = {
    id: "record",
    created_by: null,
    created_by_name: null,
    body: "고객 수정",
    record_kind: "change",
    occurred_at: stamp,
    task_id: null,
    occurrence_on: null,
    entity_id: "target",
    tag_ids: [],
    version: 1,
    created_at: stamp,
    updated_at: stamp,
    change: {
      event_id: "event",
      target_kind: "entity",
      target_id: "target",
      target_title: "고객",
      action: "update",
      source: "http",
      before: { title: "당시 이름", properties: { prop_1: 0, prop_2: false, prop_3: null, legacy: "과거 값" } },
      after: null,
      path: null,
    },
  };
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <ChangeContext record={record} />
    </MemoryRouter>,
  );
  expect(html).toContain("<dt>이름</dt>");
  expect(html).toContain("<dt>항목 1</dt><dd>0</dd>");
  expect(html).toContain("<dt>항목 2</dt><dd>아니오</dd>");
  expect(html).toContain("<dt>항목 3</dt><dd>값 없음</dd>");
  expect(html).toContain("<dt>legacy</dt><dd>과거 값</dd>");
  expect(html).not.toContain("<pre>");
  expect(html).not.toContain("prop_1");
  const captured = {
    ...record,
    change: {
      ...record.change!,
      before: { properties: { prop_1: "옛 값" }, property_labels: { prop_1: "당시 항목" } },
      after: { properties: { prop_1: "새 값" }, property_labels: { prop_1: "변경 후 항목" } },
    },
  };
  const historical = renderToStaticMarkup(
    <MemoryRouter>
      <ChangeContext record={captured} />
    </MemoryRouter>,
  );
  expect(historical).toContain("<dt>당시 항목</dt><dd>옛 값</dd>");
  expect(historical).toContain("<dt>변경 후 항목</dt><dd>새 값</dd>");
  expect(historical).not.toContain("property_labels");
});

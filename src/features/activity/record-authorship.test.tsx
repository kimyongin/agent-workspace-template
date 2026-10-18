import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { RecordResult } from "@contracts/record.ts";
import { RecordDataFields } from "./RecordDataFields.tsx";

vi.mock("../../lib/api.ts", () => ({ createScopedApi: () => vi.fn(), ApiError: Error }));
const record: RecordResult = {
  id: "00000000-0000-4000-8000-000000000001",
  created_by: "00000000-0000-4000-8000-000000000009",
  created_by_name: "보관된 작성자",
  record_kind: "result",
  change: null,
  entity_id: null,
  task_id: "00000000-0000-4000-8000-000000000002",
  occurrence_on: null,
  body: "공유 수행 결과",
  occurred_at: "2026-10-01T00:00:00Z",
  tag_ids: [],
  version: 1,
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
};
const render = (value: RecordResult, editing: boolean) => renderToStaticMarkup(
  <RecordDataFields record={value} body={editing ? <textarea aria-label="본문" defaultValue={value.body} /> : undefined} />,
);
it.each([false, true])("record author is the saved bounded name in view/edit (editing=%s)", editing => {
  const html = render(record, editing);
  expect(html).toContain("<dt>작성자</dt><dd>보관된 작성자</dd>");
  expect(html).not.toContain(record.created_by!);
});
it("the retained name remains readable after its initiating account is removed", () => {
  expect(render({ ...record, created_by: null }, false)).toContain("<dt>작성자</dt><dd>보관된 작성자</dd>");
});
it.each([false, true])("missing author name uses a dash without exposing its user ID (editing=%s)", editing => {
  const html = render({ ...record, created_by_name: null }, editing);
  expect(html).toContain("<dt>작성자</dt><dd>—</dd>");
  expect(html).not.toContain(record.created_by!);
});

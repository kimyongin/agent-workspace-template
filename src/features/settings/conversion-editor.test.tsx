vi.mock("../../lib/api.ts", () => ({ createScopedApi: () => vi.fn() }));
import { expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ConversionEditor } from "./ConversionEditor.tsx";
import { initialEntityDefinition } from "@contracts/entity-type.ts";
import type { EntitySchemaChange } from "@contracts/entity-schema-change.ts";
const plan = (path: string): EntitySchemaChange => ({
  id: "00000000-0000-4000-8000-000000000001",
  type_id: "00000000-0000-4000-8000-000000000002",
  source_schema_version: 1,
  source_template_fingerprint: "fixture",
  version: 1,
  status: "draft",
  change_kind: "migration_required",
  edits: [],
  migration: { rules: [], overrides: [] },
  executable: false,
  reservations: {},
  target: initialEntityDefinition("이름"),
  fingerprint: "fixture",
  analysis: null,
  diff: [{
    path,
    before: { "x-order": 30, type: "integer" },
    after: null,
    before_present: true,
    after_present: false,
    kind: "migration_required",
    reason: "속성 제거",
    next_action: "명시 제거",
  }],
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
});
test("removed property has an explicit removal picker while a removed constraint creates no ghost property", () => {
  const render = (path: string) =>
    renderToStaticMarkup(
      <ConversionEditor
        plan={plan(path)}
        migration={{ rules: [], overrides: [] }}
        onChange={() => {}}
        disabled={false}
      />,
    );
  expect(render("properties.prop_3")).toContain('aria-label="삭제한 항목 변환 방식"');
  expect(render("properties.prop_3")).toContain('value="remove"');
  expect(render("properties.prop_3.maximum")).not.toContain('aria-label="삭제한 항목 변환 방식"');
});

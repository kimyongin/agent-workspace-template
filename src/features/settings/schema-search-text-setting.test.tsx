import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SchemaSearchTextSetting } from "./SchemaSearchTextSetting.tsx";

it("selected nullable text is editable while date, choices and archived fields cannot be selected", () => {
  const field = { type: ["string", "null"] as ["string", "null"], "x-order": 20, title: "설명", "x-search-text": true };
  const render = (value = field, disabled = false) => renderToStaticMarkup(
    <SchemaSearchTextSetting field={value} disabled={disabled} onChange={() => {}} />,
  );
  expect(render()).toContain('aria-label="설명 검색에 사용"');
  expect(render()).toContain('aria-checked="true"');
  expect(render()).not.toContain('disabled=""');
  for (const value of [{ ...field, format: "date" as const }, { ...field, oneOf: [{ const: "a" }] }, { ...field, deprecated: true }]) {
    expect(render(value)).toContain('disabled=""');
  }
  expect(render(field, true)).toContain('disabled=""');
});

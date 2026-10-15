import { expect, it } from "vitest";
import { fieldInputPolicy } from "./field-input-policy.ts";
it("optional choice fields allow null in both type and choices without altering the source", () => {
  const field = { "x-order": 20, type: "string" as const, oneOf: [{ const: "a" }], title: "단위" };
  expect(fieldInputPolicy(field, false)).toEqual({
    ...field,
    type: ["string", "null"],
    oneOf: [{ const: "a" }, { const: null }],
  });
  expect(field.oneOf).toEqual([{ const: "a" }]);
});
it("required fields reject null and blank text while removing incompatible null defaults", () => {
  expect(
    fieldInputPolicy(
      { "x-order": 40, type: ["string", "null"], minLength: 0, default: null },
      true,
    ),
  )
    .toEqual({ "x-order": 40, type: "string", minLength: 1 });
  expect(
    fieldInputPolicy({ "x-order": 60, type: ["string", "null"], oneOf: [{ const: "a" }, { const: null }] }, true),
  )
    .toEqual({ "x-order": 60, type: "string", oneOf: [{ const: "a" }] });
});
it("false and zero defaults remain real values", () => {
  expect(fieldInputPolicy({ "x-order": 80, type: "boolean", default: false }, true).default)
    .toBe(false);
  expect(fieldInputPolicy({ "x-order": 90, type: "number", default: 0 }, false).default).toBe(
    0,
  );
});

it("making an existing nullable choice optional preserves the null branch title and position", () => {
  const field = {
    type: ["string", "null"] as ["string", "null"],
    "x-order": 20,
    oneOf: [{ const: "a", title: "진행" }, { const: null, title: "미정" }, { const: "null", title: "문자 코드" }],
    default: null,
  };
  expect(fieldInputPolicy(field, false).oneOf).toEqual(field.oneOf);
  expect(field.oneOf[1]).toEqual({ const: null, title: "미정" });
});

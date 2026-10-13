import { expect, it } from "vitest";
import { fieldInputPolicy } from "./field-input-policy.ts";
it("optional choice fields allow null in both type and choices without altering the source", () => {
  const field = { type: "string" as const, enum: ["a"], title: "단위" };
  expect(fieldInputPolicy(field, false)).toEqual({
    ...field,
    type: ["string", "null"],
    enum: ["a", null],
  });
  expect(field.enum).toEqual(["a"]);
});
it("required fields reject null and blank text while removing incompatible null defaults", () => {
  expect(
    fieldInputPolicy(
      { type: ["string", "null"], minLength: 0, default: null },
      true,
    ),
  )
    .toEqual({ type: "string", minLength: 1 });
  expect(
    fieldInputPolicy({ type: ["string", "null"], enum: ["a", null] }, true),
  )
    .toEqual({ type: "string", enum: ["a"] });
});
it("false and zero defaults remain real values", () => {
  expect(fieldInputPolicy({ type: "boolean", default: false }, true).default)
    .toBe(false);
  expect(fieldInputPolicy({ type: "number", default: 0 }, false).default).toBe(
    0,
  );
});

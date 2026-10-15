import { expect, test } from "vitest";
import { memoDocument } from "./template-memo-document.ts";
const variables = [
  { value: "대상", label: "대상" },
  { value: "엔터티.이후.prop_2", label: "가격 · 이후" },
  { value: "엔터티.이후.prop_3", label: "가격 · 이후" },
  { value: "엔터티.이전.prop_4", label: "특수 $ . ${이름$}\n · 이전" },
];
test("token documents preserve canonical, duplicate, legacy, dollar literal and unknown syntax", () => {
  const raw =
    "$$대상$$ $대상$ ${엔터티.이후.prop_2$} $엔터티.이후.prop_3$ $엔터티.이전.prop_4$ $가격 · 이후$ $없는변수$ $미완성";
  const document = memoDocument(raw, variables);
  expect(document.map((part) => part.text).join("")).toBe(raw);
  expect(document.filter((part) => part.variable).map((part) => part.variable!.value)).toEqual(
    variables.map((item) => item.value),
  );
  expect(document.filter((part) => part.variable).slice(1, 3).map((part) => part.variable!.label)).toEqual([
    "가격 · 이후",
    "가격 · 이후",
  ]);
  expect(memoDocument("$$엔터티.이후.prop_2$$", variables)).toEqual([{ text: "$$엔터티.이후.prop_2$$" }]);
});
test("renaming changes only the displayed token label, never the serialized binding", () => {
  const raw = "$엔터티.이후.prop_2$";
  expect(memoDocument(raw, [{ ...variables[1], label: "새 가격" }])).toEqual([{
    text: raw,
    variable: { ...variables[1], label: "새 가격" },
  }]);
  expect(memoDocument(raw, [])).toEqual([{ text: raw }]);
});

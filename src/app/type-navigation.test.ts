import { expect, test } from "vitest";
import type { EntityType } from "@contracts/entity-type.ts";
import { defaultNavigationRefs, resolveNavigationRefs, typeListSearch } from "./type-navigation.ts";
const type = (id: string, label: string, archived = false): EntityType => ({
  id,
  label,
  archived,
  icon_id: "leaf",
  created_at: id,
  updated_at: id,
  version: 1,
  schema_version: 1,
  next_property_number: 2,
});
test("default shortcuts follow active type identities with fixed business access", () => {
  expect(resolveNavigationRefs(defaultNavigationRefs([]), []).map((entry) => entry.label)).toEqual([
    "전체 자료",
    "할 일",
    "기록",
    "원칙",
  ]);
  const types = [type("2", "상품"), type("1", "재료"), type("3", "보관", true)];
  expect(resolveNavigationRefs(defaultNavigationRefs(types), types).map((entry) => entry.label)).toEqual([
    "재료",
    "상품",
    "할 일",
    "기록",
  ]);
  expect(resolveNavigationRefs(defaultNavigationRefs([types[0]]), types).map((entry) => entry.label)).toEqual([
    "상품",
    "할 일",
    "기록",
    "원칙",
  ]);
});
test("type switches preserve common query and clear definition-specific state", () => {
  expect(
    typeListSearch(
      new URLSearchParams(
        "keyword=한글&tag_id=t&entity_type_id=old&property_filters=old&sort=prop_2&pages=3&cursor=old&create=1",
      ),
      "new",
    ).toString(),
  ).toBe("keyword=%ED%95%9C%EA%B8%80&tag_id=t&entity_type_id=new");
});
test("refs resolve live labels and retain archive state without duplicate shortcuts", () => {
  expect(
    resolveNavigationRefs([{ kind: "type", id: "1" }, { kind: "type", id: "missing" }, { kind: "type", id: "1" }], [
      type("1", "새 이름", true),
    ]),
  ).toMatchObject([{ key: "type:1", label: "새 이름", archived: true }]);
});

test("switching kinds keeps the chosen view and filter disclosure", () => {
  expect(
    typeListSearch(new URLSearchParams("view=cards&filters=1&property_filters=old&sort=old&cursor=old"), "new")
      .toString(),
  ).toBe("view=cards&filters=1&entity_type_id=new");
});

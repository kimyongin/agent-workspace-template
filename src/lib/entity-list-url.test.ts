import { expect, it } from "vitest";
import {
  changeEntityListQuery,
  detailListLink,
  detailListReturn,
  detailModeLink,
  readEntityListUrl,
  writeEntityListUrl,
} from "./entity-list-url.ts";
const kind = "00000000-0000-4000-8000-000000000001",
  raw = JSON.stringify([{ key: "prop_2", operator: "eq", value: "한".repeat(4096) }]);
it("detail visits accept only their owner's internal list and retain invalid conditions", () => {
  const location = {
    pathname: "/entities/app%3Arow",
    search: "?list=" + encodeURIComponent("/entities?property_filters=bad&property_filters=other#entity-app%3Arow"),
    hash: "",
  };
  expect(detailListReturn(location)).toBe("/entities?property_filters=bad&property_filters=other#entity-app%3Arow");
  for (
    const list of [
      "https://outside.invalid/entities",
      "//outside.invalid/entities",
      "/records?keyword=other",
      "/entities\\outside",
      "/entities/../records",
    ]
  ) {
    expect(detailListReturn({ ...location, search: "?list=" + encodeURIComponent(list) })).toBeNull();
  }
});
it("copied long filter URLs keep HTTP search bounded and preserve type and legacy entity anchor", () => {
  const url = writeEntityListUrl(
    new URLSearchParams({ entity_type_id: kind, keyword: "보존", pages: "2" }),
    raw,
    "#entity-app%3Arow",
  );
  expect(url.search.length).toBeLessThan(2048);
  expect(url.hash.startsWith("#property_filters=")).toBe(true);
  const parsed = readEntityListUrl(new URLSearchParams(url.search), url.hash);
  expect(parsed).toEqual({ raw, anchor: "#entity-app%3Arow", error: null });
  const link = detailListLink("/entities/app%3Arow", `/entities?${url.search}${url.hash}`);
  const detail = new URL(link, "https://fixture.invalid");
  expect(detail.search.length).toBeLessThan(2048);
  expect(detailListReturn({ pathname: detail.pathname, search: detail.search, hash: detail.hash })).toBe(
    `/entities?${url.search}${url.hash}`,
  );
});
it("short query compatibility and explicit ambiguity/invalid/type errors never silently broaden a list", () => {
  const short = '[{"key":"prop_2","operator":"eq","value":"짧음"}]';
  const url = writeEntityListUrl(new URLSearchParams({ entity_type_id: kind }), short, "");
  expect(new URLSearchParams(url.search).get("property_filters")).toBe(short);
  expect(url.hash).toBe("");
  const long = writeEntityListUrl(new URLSearchParams({ entity_type_id: kind }), raw, "");
  for (
    const [params, hash] of [
      [new URLSearchParams({ entity_type_id: kind, property_filters: short }), long.hash],
      [new URLSearchParams({ entity_type_id: "other" }), long.hash],
      [new URLSearchParams({ entity_type_id: kind }), long.hash + "&property_filters=duplicate"],
      [new URLSearchParams({ entity_type_id: kind }), "#property_filters=%zz&entity_type_id=" + kind],
      [new URLSearchParams({ entity_type_id: kind, property_filters: "not JSON" }), ""],
    ] as const
  ) expect(readEntityListUrl(params, hash).error).not.toBeNull();
  const reset = writeEntityListUrl(new URLSearchParams({ entity_type_id: kind, keyword: "保留" }), null, "");
  expect(reset.hash).toBe("");
  expect(new URLSearchParams(reset.search).get("keyword")).toBe("保留");
});

it("common filter changes retain invalid drafts until repair", () => {
  const invalid = new URLSearchParams({ entity_type_id: kind, property_filters: "bad JSON", keyword: "old" });
  const next = new URLSearchParams(invalid);
  next.set("keyword", "new");
  const changed = changeEntityListQuery(next, invalid, "");
  expect(new URLSearchParams(changed.search).get("property_filters")).toBe("bad JSON");
  expect(readEntityListUrl(new URLSearchParams(changed.search), changed.hash).error).not.toBeNull();
});

it("same-detail edit and creation modes retain long filters, selected type and list focus anchor", () => {
  const list = writeEntityListUrl(
    new URLSearchParams({ entity_type_id: kind, keyword: "保留" }),
    raw,
    "#entity-app%3Arow",
  );
  const detail = new URL(
    detailListLink("/entities/app%3Arow", `/entities?${list.search}${list.hash}`),
    "https://fixture.invalid",
  );
  for (const mode of ["edit", "task", "record", "closed"]) {
    const params = new URLSearchParams(detail.search);
    if (mode === "edit") params.set("edit", "1");
    else if (mode !== "closed") params.set("create", mode);
    const next = new URL(detailModeLink(detail.pathname, params, detail.hash), detail.origin);
    const restored = new URL(
      detailListReturn({ pathname: next.pathname, search: next.search, hash: next.hash })!,
      detail.origin,
    );
    const state = readEntityListUrl(restored.searchParams, restored.hash);
    expect(state.error).toBeNull();
    expect(state.raw?.length).toBe(raw.length);
    expect(restored.searchParams.get("entity_type_id")).toBe(kind);
    expect(restored.searchParams.get("keyword")).toBe("保留");
    expect(state.anchor).toBe("#entity-app%3Arow");
    expect(next.search.length).toBeLessThan(2048);
  }
});

it("a related task's mode switch retains the entity owner list and long filter fragment", () => {
  const list = writeEntityListUrl(
    new URLSearchParams({ entity_type_id: kind, keyword: "보관" }),
    raw,
    "#entity-app%3Arow",
  );
  const detail = new URL(
    detailListLink("/tasks/20261013-OGL83YTE", `/entities?${list.search}${list.hash}`),
    "https://fixture.invalid",
  );
  const params = new URLSearchParams(detail.search);
  params.set("edit", "1");
  const edited = new URL(detailModeLink(detail.pathname, params, detail.hash), detail.origin);
  expect(edited.searchParams.get("edit")).toBe("1");
  const restored = detailListReturn(edited, "/entities");
  expect(restored).toBe(`/entities?${list.search}${list.hash}`);
  expect(edited.search.length).toBeLessThan(2048);
  expect(readEntityListUrl(new URL(restored!, detail.origin).searchParams, edited.hash).error).toBeNull();
});

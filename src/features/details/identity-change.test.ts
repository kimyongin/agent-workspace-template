import { describe, expect, it } from "vitest";
import { replaceEntityDetailVisit } from "./identity-change.ts";

describe("식별 변경 뒤 탐색", () => {
  it("목록 조건·다른 펼침을 유지하고 이전 대상의 펼침·Unicode 초점만 옮긴다", () => {
    const list = new URLSearchParams({ keyword: "보관", pages: "2", scroll: "430" });
    list.append("open", "/entities/app%3AA%25%ED%95%9C%EA%B8%80");
    list.append("open", "/entities/app%3Aother");
    const params = new URLSearchParams({ edit: "1", edit_from: "list", list: `/entities?${list}#entity-app%3AA%25%ED%95%9C%EA%B8%80` });
    const result = replaceEntityDetailVisit({ pathname: "/entities/app%3AA%25%ED%95%9C%EA%B8%80", search: `?${params}` }, "app:A%한글", "app:B%다음");
    const url = new URL(result.path, "https://workspace.invalid");
    expect(url.pathname).toBe("/entities/app%3AB%25%EB%8B%A4%EC%9D%8C");
    expect(url.searchParams.has("edit")).toBe(false);
    const restored = new URL(url.searchParams.get("list")!, "https://workspace.invalid");
    expect(restored.searchParams.getAll("open")).toEqual(["/entities/app%3AB%25%EB%8B%A4%EC%9D%8C", "/entities/app%3Aother"]);
    expect([restored.searchParams.get("keyword"), restored.searchParams.get("pages"), restored.searchParams.get("scroll")]).toEqual(["보관", "2", "430"]);
    expect(restored.hash).toBe("#entity-app%3AB%25%EB%8B%A4%EC%9D%8C");
    expect(result.options).toEqual({ replace: true, state: { rekeyedDetail: "/entities/app%3AA%25%ED%95%9C%EA%B8%80" } });
  });
});

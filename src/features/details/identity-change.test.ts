import { describe, expect, it } from "vitest";
import { replaceEntityDetailVisit } from "./identity-change.ts";

describe("식별 변경 뒤 탐색", () => {
  it("식별자를 교체해도 중복된 잘못된 조건을 정상 조건으로 바꾸지 않는다", () => {
    const list = "/entities?property_filters=%5B%5D&property_filters=bad&open=%2Fentities%2Fapp%253Aold#entity-app%3Aold";
    const result = replaceEntityDetailVisit({ pathname: "/entities/app%3Aold", search: "?edit=1&list=" + encodeURIComponent(list) }, "app:old", "app:new");
    const detail = new URL(result.path, "https://fixture.invalid");
    const restored = new URL(detail.searchParams.get("list")!, detail.origin);
    expect(restored.searchParams.getAll("property_filters")).toEqual(["[]", "bad"]);
    expect(restored.searchParams.getAll("open")).toEqual(["/entities/app%3Anew"]);
    expect(restored.hash).toBe("#entity-app%3Anew");
  });
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

it("rekey preserves long-filter copied detail fragments and rewrites their original entity anchor",()=>{
  const raw=JSON.stringify([{key:"prop_2",operator:"eq",value:"한".repeat(4096)}]);
  const hash=`#${new URLSearchParams({property_filters:raw,entity_type_id:"00000000-0000-4000-8000-000000000001",anchor:"entity-app:old"})}`;
  const result=replaceEntityDetailVisit({pathname:"/entities/app%3Aold",search:"?list="+encodeURIComponent("/entities?entity_type_id=00000000-0000-4000-8000-000000000001"),hash},"app:old","app:new");
  const url=new URL(result.path,"https://fixture.invalid");expect(url.search.length).toBeLessThan(2048);
  expect(new URLSearchParams(url.hash.slice(1)).get("anchor")).toBe("entity-app:new");expect(new URLSearchParams(url.hash.slice(1)).get("property_filters")).toBe(raw);
});

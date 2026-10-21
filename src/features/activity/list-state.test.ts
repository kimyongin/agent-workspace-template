import { describe, expect, it } from "vitest";
import { anchorId,listAnchor,listDetailVisit,listScope,requestedPages,safeListReturn } from "./list-state.ts";

describe("list return paths",()=>{
  it("preserves every expanded item when returning from a detail",()=>{
    const params=new URLSearchParams("open=%2Ftasks%2Fa&open=%2Ftasks%2Fb&pages=2");
    const path=listDetailVisit("tasks",{pathname:"/tasks",search:params.toString(),hash:""},"00000000-0000-4000-8000-000000000001",200).back;
    const returned=new URL(safeListReturn(path,"tasks","/tasks"),"https://activity.invalid");
    expect(returned.searchParams.getAll("open")).toEqual(["/tasks/a","/tasks/b"]);
    expect(listScope(returned.searchParams)).toBe("");
  });
  it("preserves all URL filters, loaded extent and the focus target while constraining return paths", () => {
    const params = new URLSearchParams("kind=once&status=open&tag_id=tag&entity_id=entity&pages=3&scroll=9");
    const id = "00000000-0000-4000-8000-000000000001";
    const path = listDetailVisit("tasks", {pathname:"/tasks",search:params.toString(),hash:""}, id, 234.6).back;
    const url = new URL(path, "https://activity.invalid");
    expect(url.searchParams.get("pages")).toBe("3");
    expect(url.searchParams.get("scroll")).toBe("235");
    expect(url.searchParams.get("entity_id")).toBe("entity");
    expect(anchorId("tasks", url.hash)).toBe(id);
    expect(anchorId("records", url.hash)).toBeUndefined();
    expect(listScope(url.searchParams)).toBe("entity_id=entity&kind=once&status=open&tag_id=tag");
    expect(safeListReturn(path, "tasks", "/tasks")).toBe(path);
    for (
      const unsafe of ["https://evil.invalid/tasks", "//evil.invalid/tasks", "/tasks/other", "/principles", "/tasks\\x"]
    ) {
      expect(safeListReturn(unsafe, "tasks", "/tasks")).toBe("/tasks");
    }
    expect(safeListReturn("/records?tasks_pages=2", "tasks", "/tasks")).toBe("/tasks?pages=2&legacy_activity=1");
    expect(safeListReturn("/records?q=unrelated", "tasks", "/tasks")).toBe("/tasks");
    expect(safeListReturn(`/tasks?records_pages=2#activity-records-${id}`, "records", "/records"))
      .toBe(`/records?pages=2&legacy_activity=1#activity-records-${id}`);
    for (const pages of ["0", "-1", "1.5", "oops"]) expect(requestedPages(new URLSearchParams({ pages }))).toBe(1);
    expect(requestedPages(new URLSearchParams({ pages: "10000000" }))).toBe(250);
  });
  it("restores dated server IDs and legacy UUIDs for task and record list focus",()=>{
    for(const kind of ["tasks","records"] as const){
      for(const id of ["20261011-OGL83YTE","00000000-0000-4000-8000-000000000001"]){
        const returned=new URL(listDetailVisit(kind,{pathname:`/${kind}`,search:"?pages=3",hash:""},id,200).back,"https://activity.invalid");
        expect(anchorId(kind,returned.hash)).toBe(id);
      }
      for(const invalid of ["20260230-OGL83YTE","20261011-ogl83yte","not-an-id"]){
        expect(anchorId(kind,`#${listAnchor(kind,invalid)}`)).toBeUndefined();
      }
    }
  });
  it("restores namespaced entity anchors including exact Unicode, separators and percent text",()=>{
    for(const id of ["00000000-0000-4000-8000-000000000001:00000000-0000-4000-8000-000000000001:00000000-0000-4000-8000-000000000001","00000000-0000-4000-8000-000000000001:00000000-0000-4000-8000-000000000002:고객 / # ? % : 7","00000000-0000-4000-8000-000000000001:00000000-0000-4000-8000-000000000001:%3A"]){
      const returned=new URL(listDetailVisit("entities",{pathname:"/entities",search:"?pages=2",hash:""},id,42).back,"https://activity.invalid");
      expect(anchorId("entities",returned.hash)).toBe(id);
      expect(decodeURIComponent(returned.hash.slice(1))).toBe(listAnchor("entities",id));
      expect(returned.hash).not.toContain("# ?");
      expect(anchorId("tasks",returned.hash)).toBeUndefined();
    }
    expect(anchorId("entities","#entity-not-a-tuple")).toBeUndefined();
    expect(anchorId("entities","#entity-app%3A%ZZ")).toBeUndefined();
  });

});

it("entity return paths keep long filter fragments and restore the old entity focus anchor",()=>{
  const raw=JSON.stringify([{key:"prop_2",operator:"eq",value:"한".repeat(4096)}]);
  const params=new URLSearchParams({entity_type_id:"00000000-0000-4000-8000-000000000001",pages:"2"});
  const hash=`#${new URLSearchParams({property_filters:raw,entity_type_id:params.get("entity_type_id")!})}`;
  const visit=listDetailVisit("entities",{pathname:"/entities",search:params.toString(),hash},"00000000-0000-4000-8000-000000000001:00000000-0000-4000-8000-000000000001:one",42);
  const back=new URL(visit.back,"https://fixture.invalid");
  expect(back.search.length).toBeLessThan(2048);expect(anchorId("entities",back.hash)).toBe("00000000-0000-4000-8000-000000000001:00000000-0000-4000-8000-000000000001:one");
  expect(new URLSearchParams(back.hash.slice(1)).get("property_filters")).toBe(raw);
  expect(visit.origin).toEqual({pathname:"/entities",search:back.search,hash:back.hash});
  const detail=new URL(visit.to,"https://fixture.invalid");
  expect(detail.search.length).toBeLessThan(2048);
  expect(detail.searchParams.get("list")).toBe("/entities?entity_type_id=00000000-0000-4000-8000-000000000001&pages=2&scroll=42");
  expect(detail.hash).toBe(back.hash);
});

it("a row visit preserves duplicate invalid filters rather than broadening its return list",()=>{
  const visit=listDetailVisit("entities",{pathname:"/entities",search:"?entity_type_id=00000000-0000-4000-8000-000000000001&property_filters=%5B%5D&property_filters=bad",hash:""},"00000000-0000-4000-8000-000000000001:00000000-0000-4000-8000-000000000001:one",42.4);
  const returned=new URL(visit.back,"https://fixture.invalid");
  expect(returned.searchParams.getAll("property_filters")).toEqual(["[]","bad"]);
  expect(returned.searchParams.get("scroll")).toBe("42");
  expect(returned.hash).toBe("#entity-00000000-0000-4000-8000-000000000001%3A00000000-0000-4000-8000-000000000001%3Aone");
});

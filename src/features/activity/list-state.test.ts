import { describe, expect, it } from "vitest";
import { anchorId,listAnchor,listReturnPath,listScope,requestedPages,safeListReturn } from "./list-state.ts";

describe("list return paths",()=>{
  it("preserves every expanded item when returning from a detail",()=>{
    const params=new URLSearchParams("open=%2Ftasks%2Fa&open=%2Ftasks%2Fb&pages=2");
    const path=listReturnPath("tasks",params,"00000000-0000-4000-8000-000000000001",200);
    const returned=new URL(safeListReturn(path,"tasks","/tasks"),"https://activity.invalid");
    expect(returned.searchParams.getAll("open")).toEqual(["/tasks/a","/tasks/b"]);
    expect(listScope(returned.searchParams)).toBe("");
  });
  it("preserves all URL filters, loaded extent and the focus target while constraining return paths", () => {
    const params = new URLSearchParams("kind=once&status=open&tag_id=tag&entity_id=entity&pages=3&scroll=9");
    const id = "00000000-0000-4000-8000-000000000001";
    const path = listReturnPath("tasks", params, id, 234.6);
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
  it("restores dated server IDs and legacy UUIDs for task, record and principle list focus",()=>{
    for(const kind of ["tasks","records","principles"] as const){
      for(const id of ["20261011-OGL83YTE","00000000-0000-4000-8000-000000000001"]){
        const returned=new URL(listReturnPath(kind,new URLSearchParams("pages=3"),id,200),"https://activity.invalid");
        expect(anchorId(kind,returned.hash)).toBe(id);
      }
      for(const invalid of ["20260230-OGL83YTE","20261011-ogl83yte","not-an-id"]){
        expect(anchorId(kind,`#${listAnchor(kind,invalid)}`)).toBeUndefined();
      }
    }
  });
  it("restores namespaced entity anchors including exact Unicode, separators and percent text",()=>{
    for(const id of ["app:00000000-0000-4000-8000-000000000001","crm:고객 / # ? % : 7","app:%3A"]){
      const returned=new URL(listReturnPath("entities",new URLSearchParams("pages=2"),id,42),"https://activity.invalid");
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
  const back=new URL(listReturnPath("entities",params,"app:one",42,"/entities",hash),"https://fixture.invalid");
  expect(back.search.length).toBeLessThan(2048);expect(anchorId("entities",back.hash)).toBe("app:one");
  expect(new URLSearchParams(back.hash.slice(1)).get("property_filters")).toBe(raw);
});

import { expect, it } from "vitest";
import { resetTabFilters } from "./TabSearch.tsx";
it("clears filters independently of the applied search; mode is fixed",()=>{
  const cleared=resetTabFilters(new URLSearchParams("q=한글&mode=auto&kind=once&tag_id=tag&pages=3&scroll=100"));
  expect([...cleared]).toEqual([["q","한글"]]);
});

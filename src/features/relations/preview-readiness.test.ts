import { expect,it } from "vitest";
import { createPreviewReadiness } from "./preview-readiness.ts";
it("waits for the expected preview and ignores unmounted or unrelated reports",()=>{
  const state=createPreviewReadiness("/records/a");expect(state.snapshot()).toBe(false);
  state.track("/records/b").settle(true);expect(state.snapshot()).toBe(false);
  const old=state.track("/records/a"),current=state.track("/records/a");old.settle(true);expect(state.snapshot()).toBe(false);
  current.settle(true);expect(state.snapshot()).toBe(true);old.dispose();expect(state.snapshot()).toBe(true);
  current.dispose();expect(state.snapshot()).toBe(false);current.settle(true);expect(state.snapshot()).toBe(false);
});
it("restores a collapsed list without waiting for a preview",()=>{expect(createPreviewReadiness(null).snapshot()).toBe(true);});

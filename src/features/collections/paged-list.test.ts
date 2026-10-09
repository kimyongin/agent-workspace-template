import { describe, expect, it, vi } from "vitest";
import { createPagedList, type ListPage } from "./paged-list.ts";
type Row = { id: string };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

describe("paged list lifecycle", () => {
  it("refreshes accepted pages atomically and retains them on failure until retry succeeds", async () => {
    const held = deferred<ListPage<Row>>();
    const load = vi.fn().mockResolvedValueOnce({items:[{id:"old"}],next_cursor:null})
      .mockImplementationOnce(()=>held.promise)
      .mockRejectedValueOnce(new Error("refresh unavailable"))
      .mockResolvedValueOnce({items:[{id:"latest"}],next_cursor:null});
    const list = createPagedList({load}); await list.restore(1);
    const refresh = list.refresh(); expect(list.snapshot().page?.items).toEqual([{id:"old"}]);
    held.resolve({items:[{id:"updated"}],next_cursor:null}); await refresh;
    expect(list.snapshot().page?.items).toEqual([{id:"updated"}]);
    await list.refresh(); expect(list.snapshot().page?.items).toEqual([{id:"updated"}]);
    expect(list.snapshot().error).toBeInstanceOf(Error);
    await list.retry(); expect(list.snapshot().page?.items).toEqual([{id:"latest"}]);
  });
  it("keeps accepted rows and metadata when a repeated continuation fails", async () => {
    const load = vi.fn().mockResolvedValueOnce({items:[{id:"kept"}],next_cursor:"next",search_state:"ok"})
      .mockResolvedValueOnce({items:[{id:"rejected"}],next_cursor:"next",search_state:"fallback"});
    const list = createPagedList({load}); await list.restore(2);
    expect(list.snapshot().page).toEqual({items:[{id:"kept"}],next_cursor:"next",search_state:"ok",pages:1});
    expect(list.snapshot().error).toBeInstanceOf(Error);
    expect(list.snapshot().completion).toBeNull();
  });
  it("rejects a cursor cycle across manual appends and retries the rejected page", async () => {
    const load = vi.fn().mockResolvedValueOnce({items:[{id:"first"}],next_cursor:"a"})
      .mockResolvedValueOnce({items:[{id:"second"}],next_cursor:"b"})
      .mockResolvedValueOnce({items:[{id:"rejected"}],next_cursor:"a"})
      .mockResolvedValueOnce({items:[{id:"third"}],next_cursor:null});
    const list = createPagedList({load}); await list.restore(1);
    list.more(); await vi.waitFor(()=>expect(list.snapshot().busy).toBe(false));
    list.more(); await vi.waitFor(()=>expect(list.snapshot().error).toBeInstanceOf(Error));
    expect(list.snapshot().page).toEqual({items:[{id:"first"},{id:"second"}],next_cursor:"b",pages:2});
    await list.retry();
    expect(load.mock.calls.map(([cursor])=>cursor)).toEqual([undefined,"a","b","b"]);
    expect(list.snapshot().page?.items).toEqual([{id:"first"},{id:"second"},{id:"third"}]);
  });
  it("caps restoration, batches publication, and flushes a partial batch on failure", async () => {
    for (const failAt of [23, null]) {
      const published:number[]=[];
      const load=vi.fn(async(cursor?:string)=>{const n=Number(cursor??0);if(n===failAt)throw Error("network");return {items:[{id:String(n)}],next_cursor:String(n+1)};});
      const list=createPagedList({load});let last=0;
      list.subscribe(()=>{const page=list.snapshot().page;if(page&&page.pages!==last){last=page.pages;published.push(last);}});
      await list.restore(100000);
      expect(load).toHaveBeenCalledTimes(failAt===23?24:250);
      expect(published).toEqual(failAt===23?[1,20,23]:[1,...Array.from({length:12},(_,i)=>(i+1)*20),250]);
      expect(list.snapshot().page?.items.at(-1)?.id).toBe(failAt===23?"22":"249");
    }
  });
  it("aborts and ignores success from a superseded request", async()=>{
    const late=deferred<ListPage<Row>>(),signals:AbortSignal[]=[];
    const load=vi.fn((_cursor:string|undefined,signal:AbortSignal)=>{signals.push(signal);return signals.length===1?late.promise:Promise.resolve({items:[{id:"current"}],next_cursor:null});});
    const list=createPagedList({load});const first=list.restore(1);list.cancel();await list.restore(1);
    late.resolve({items:[{id:"stale"}],next_cursor:null});await first;
    expect(signals[0].aborted).toBe(true);expect(list.snapshot().page?.items).toEqual([{id:"current"}]);expect(list.snapshot().busy).toBe(false);
  });
  it("reserves one append and acknowledges its URL without a duplicate read",async()=>{
    const next=deferred<ListPage<Row>>();
    const load=vi.fn().mockResolvedValueOnce({items:[{id:"first"}],next_cursor:"next"}).mockReturnValueOnce(next.promise);
    const list=createPagedList({load,retainOnDecrease:true});await list.restore(1,"first");
    expect(list.more()).toBe(2);expect(list.more()).toBeUndefined();await list.restore(2,"first");
    expect(load).toHaveBeenCalledTimes(2);next.resolve({items:[{id:"first"},{id:"second"}],next_cursor:null});
    await vi.waitFor(()=>expect(list.snapshot().busy).toBe(false));
    expect(list.snapshot().page?.items).toEqual([{id:"first"},{id:"second"}]);expect(list.snapshot().completion?.source).toBe("more");
  });
  it("keeps a fast failed append visible when its URL acknowledgement arrives after the response",async()=>{
    const load=vi.fn().mockResolvedValueOnce({items:[{id:"first"}],next_cursor:"next"}).mockRejectedValueOnce(Error("network"))
      .mockResolvedValueOnce({items:[{id:"second"}],next_cursor:null});
    const list=createPagedList({load,retainOnDecrease:true});await list.restore(1,"first");
    expect(list.more()).toBe(2);await vi.waitFor(()=>expect(list.snapshot().busy).toBe(false));
    await list.restore(2,"first");
    expect(load).toHaveBeenCalledTimes(2);expect(list.snapshot().error).not.toBeNull();
    expect(list.snapshot().page?.items).toEqual([{id:"first"}]);
    await list.retry();expect(load.mock.calls.map(([cursor])=>cursor)).toEqual([undefined,"next","next"]);
    expect(list.snapshot().page?.items).toEqual([{id:"first"},{id:"second"}]);
  });
  it("retries a failed append at its cursor while retaining the accepted prefix",async()=>{
    const next=deferred<ListPage<Row>>(),error=Error("network");
    const load=vi.fn().mockResolvedValueOnce({items:[{id:"first"}],next_cursor:"next"}).mockRejectedValueOnce(error)
      .mockReturnValueOnce(next.promise);
    const list=createPagedList({load});await list.restore(1);list.more();await vi.waitFor(()=>expect(list.snapshot().error).not.toBeNull());
    const retry=list.retry();expect(list.snapshot().busy).toBe(true);expect(list.snapshot().error).toBe(error);
    expect(list.snapshot().page?.items).toEqual([{id:"first"}]);
    next.resolve({items:[{id:"second"}],next_cursor:null});await retry;expect(list.snapshot().error).toBeNull();
    expect(load.mock.calls.map(([cursor])=>cursor)).toEqual([undefined,"next","next"]);expect(list.snapshot().page?.items).toEqual([{id:"first"},{id:"second"}]);
  });
  it("preserves restart versus resume restoration retry",async()=>{
    for(const restoreRetry of ["restart","resume"] as const){
      const load=vi.fn().mockResolvedValueOnce({items:[{id:"first"}],next_cursor:"next"}).mockRejectedValueOnce(Error("network"));
      load.mockImplementation(async(cursor?:string)=>cursor?{items:[{id:"last"}],next_cursor:null}:{items:[{id:"fresh"}],next_cursor:"next"});
      const list=createPagedList({load,restoreRetry});await list.restore(2);await list.retry();
      expect(load.mock.calls.map(([cursor])=>cursor)).toEqual(restoreRetry==="restart"?[undefined,"next",undefined,"next"]:[undefined,"next","next"]);
      expect(list.snapshot().page?.items[0].id).toBe(restoreRetry==="restart"?"fresh":"first");
    }
  });
  it("bounds missing anchors with the caller's real lookahead policy",async()=>{
    for(const anchorLookahead of [1,5]){
      const load=vi.fn(async(cursor?:string)=>{const n=Number(cursor??0);return {items:[{id:String(n)}],next_cursor:String(n+1)};});
      const list=createPagedList({load,anchorLookahead});await list.restore(2,"missing");
      expect(load).toHaveBeenCalledTimes(2+anchorLookahead);expect(list.snapshot().completion?.anchorFound).toBe(false);
    }
  });
  it("honors a search anchor hint and stops at a deleted target's list end",async()=>{
    const load=vi.fn(async(cursor?:string)=>{const n=Number(cursor??0)+1;return {items:[{id:n===8?"target":String(n)}],next_cursor:String(n),anchor_page:n===1?8:null};});
    const list=createPagedList({load});await list.restore(1,"target");expect(load).toHaveBeenCalledTimes(8);expect(list.snapshot().completion?.anchorFound).toBe(true);
    const end=vi.fn(async()=>({items:[{id:"remaining"}],next_cursor:null}));const deleted=createPagedList({load:end});await deleted.restore(3,"deleted");expect(end).toHaveBeenCalledTimes(1);
  });
  it("restores from first page on extent reduction unless the caller retains its prefix",async()=>{
    for(const retainOnDecrease of [false,true]){
      const load=vi.fn(async(cursor?:string)=>({items:[{id:cursor??"first"}],next_cursor:cursor?null:"next"}));
      const list=createPagedList({load,retainOnDecrease});await list.restore(2);await list.restore(1);
      expect(list.snapshot().page?.pages).toBe(retainOnDecrease?2:1);expect(load).toHaveBeenCalledTimes(retainOnDecrease?2:3);
    }
  });
  it("allows manual continuation beyond the finite restoration cap",async()=>{
    const load=vi.fn(async(cursor?:string)=>{const n=Number(cursor??0);return {items:[{id:String(n)}],next_cursor:String(n+1)};});
    const list=createPagedList({load});await list.restore(250);expect(list.more()).toBe(251);await vi.waitFor(()=>expect(list.snapshot().busy).toBe(false));expect(list.snapshot().page?.pages).toBe(251);
  });
});

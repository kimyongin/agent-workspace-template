import { expect, it } from "vitest";
import { WriteAttempt } from "./write-attempt.ts";
import { ApiError } from "./api-error.ts";

it("retries the original payload and request key after an uncertain response", async () => {
  const attempt = new WriteAttempt();
  const writes: { key: string; title: string; version: number }[] = [];
  let lost = true;
  await expect(attempt.run(async () => {
    writes.push({key:attempt.requestKey(),title:"상담",version:4});
    if (lost) { lost=false; throw new ApiError(0,"network","응답 유실"); }
  })).rejects.toThrow("응답 유실");
  attempt.reset();
  await attempt.run(async () => { writes.push({key:attempt.requestKey(),title:"바뀐 입력",version:5}); });
  expect(writes).toHaveLength(2);
  expect(writes[1]).toEqual(writes[0]);
  expect(writes[0].key).toMatch(/^[0-9a-f-]{36}$/);
  await attempt.run(async()=>{writes.push({key:attempt.requestKey(),title:"다음 의도",version:5});});
  expect(writes[2].key).not.toBe(writes[0].key);
});

it("keeps an in-progress attempt and ends it only after a definite failure", async () => {
  const attempt=new WriteAttempt(); let first=true; const keys:string[]=[];
  const save=async()=>{keys.push(attempt.requestKey());if(first){first=false;throw new ApiError(409,"request_in_progress" as never,"진행 중");}throw new ApiError(409,"conflict","버전 충돌");};
  await expect(attempt.run(save)).rejects.toThrow("진행 중");
  expect(attempt.snapshot().uncertain).toBe(true);
  await expect(attempt.run(async()=>{})).rejects.toThrow("버전 충돌");
  expect(keys[1]).toBe(keys[0]);
  expect(attempt.snapshot()).toEqual({busy:false,uncertain:false});
});

it("persists only unresolved request metadata and never stores the payload",async()=>{
  const entries=new Map<string,string>();
  const storage={setItem:(k:string,v:string)=>entries.set(k,v),removeItem:(k:string)=>entries.delete(k)};
  const attempt=new WriteAttempt(storage);
  let lost=true;
  await expect(attempt.run(async()=>{attempt.track("task.update","task-1");if(lost){lost=false;throw new ApiError(503,"unavailable","private memo");}})).rejects.toThrow();
  expect([...entries.values()].map(v=>JSON.parse(v))).toEqual([{request_key:attempt.requestKey(),operation:"task.update",target:"task-1",status:"unknown"}]);
  await attempt.run(async()=>{});
  expect(entries.size).toBe(0);
});

it("an explicit new intent after cancel preserves unknown metadata and never runs the old closure",async()=>{
  const entries=new Map<string,string>();
  const attempt=new WriteAttempt({setItem:(k,v)=>entries.set(k,v),removeItem:k=>entries.delete(k)});
  let oldCalls=0;
  await expect(attempt.run(async()=>{oldCalls++;attempt.track("tag.create","");throw new ApiError(0,"network","lost");})).rejects.toThrow();
  const oldKey=attempt.requestKey();
  attempt.startNewIntent();
  let newKey="";
  await attempt.run(async()=>{newKey=attempt.requestKey();});
  expect(newKey).not.toBe(oldKey);
  expect(oldCalls).toBe(1);
  expect([...entries.values()].map(v=>JSON.parse(v).request_key)).toEqual([oldKey]);
});

import { expect, it, vi } from "vitest";
import { api } from "./api.ts";
import { WriteAttempt } from "./write-attempt.ts";
vi.mock("./supabase.ts",()=>({supabase:{auth:{getSession:async()=>({data:{session:{access_token:"fixture-token"}}})}}}));

it("HTTP retry sends the original key, target and serialized input after a lost response",async()=>{
  const fetch=vi.fn().mockRejectedValueOnce(new TypeError("response lost")).mockResolvedValueOnce(new Response(JSON.stringify({id:"server-issued",version:4}),{status:201}));
  vi.stubGlobal("fetch",fetch);
  const attempt=new WriteAttempt();const input={title:"original",expected_version:3,change_tag_ids:["tag-1"]};
  try {
    const save=async()=>{await api("PATCH","/tasks/task-1",input,undefined,attempt.requestKey());};
    await expect(attempt.run(save)).rejects.toThrow();
    input.title="mutated";input.expected_version=4;input.change_tag_ids.push("tag-2");
    await attempt.run(async()=>{await api("POST","/records",{body:"new"},undefined,attempt.requestKey());});
    expect(fetch.mock.calls[1][0]).toBe(fetch.mock.calls[0][0]);
    expect(fetch.mock.calls[1][1].body).toBe('{"title":"original","expected_version":3,"change_tag_ids":["tag-1"]}');
    expect(fetch.mock.calls[1][1].headers["Idempotency-Key"]).toBe(fetch.mock.calls[0][1].headers["Idempotency-Key"]);
    expect(fetch.mock.calls[1][1].headers["Idempotency-Key"]).toMatch(/^[0-9a-f-]{36}$/);
  } finally {vi.unstubAllGlobals();}
});

it.each([[201, ""], [200, ""], [201, "null"], [200, "null"]] as const)("%s write replies with body %j retain the request for an exact retry", async (status, responseBody) => {
  const fetch = vi.fn()
    .mockResolvedValueOnce(new Response(responseBody, { status }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ id: "server-issued", version: 2 }), { status }));
  vi.stubGlobal("fetch", fetch);
  const attempt = new WriteAttempt();
  const save = async () => { await api(status === 201 ? "POST" : "PATCH", "/tasks/task-1", { title: "committed" }, undefined, attempt.requestKey()); };
  try {
    await expect(attempt.run(save)).rejects.toMatchObject({ code: "network", retryable: true });
    expect(attempt.snapshot().uncertain).toBe(true);
    const key = attempt.requestKey();
    await attempt.run(save);
    expect(fetch.mock.calls[1][1].headers["Idempotency-Key"]).toBe(key);
    expect(fetch.mock.calls[1][1].body).toBe(fetch.mock.calls[0][1].body);
    expect(attempt.snapshot().uncertain).toBe(false);
  } finally { vi.unstubAllGlobals(); }
});

it("nullable reads and successful 204 writes keep their existing empty response behavior", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response("", { status: 200 })).mockResolvedValueOnce(new Response("null", { status: 200 })).mockResolvedValueOnce(new Response(null, { status: 204 })));
  try {
    expect(await api("GET", "/tasks/task-1")).toBeNull();
    expect(await api("GET", "/tasks/task-1")).toBeNull();
    const attempt = new WriteAttempt();
    await attempt.run(async () => { expect(await api("POST", "/tasks/task-1/delete", { expected_version: 1 }, undefined, attempt.requestKey())).toBeUndefined(); });
    expect(attempt.snapshot().uncertain).toBe(false);
  } finally { vi.unstubAllGlobals(); }
});

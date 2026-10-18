import { expect, it, vi } from "vitest";
import { createScopedApi } from "./api.ts";
import { WriteAttempt } from "./write-attempt.ts";
const auth = vi.hoisted(() => ({ actor: "actor-a", pending: null as Promise<unknown> | null }));
vi.mock("./supabase.ts", () => ({ supabase: { auth: { getSession: async () => {
  if (auth.pending) await auth.pending;
  return { data: { session: { user: { id: auth.actor }, access_token: "token" } } };
} } } }));
it("captures the workspace before token lookup and rejects a changed account", async () => {
  let release!: () => void;
  auth.pending = new Promise<void>(resolve => { release = resolve; });
  const scope = { actorId: "actor-a", workspaceId: "space-a" };
  const request = createScopedApi(scope);
  const fetch = vi.fn().mockResolvedValue(new Response('{"items":[]}'));
  vi.stubGlobal("fetch", fetch);
  try {
    const pending = request("GET", "/tasks");
    scope.workspaceId = "space-b";
    release(); await pending;
    expect(fetch.mock.calls[0][1].headers["X-Workspace-Id"]).toBe("space-a");
    auth.actor = "actor-b";
    await expect(request("GET", "/tasks")).rejects.toThrow("계정");
    expect(fetch).toHaveBeenCalledTimes(1);
  } finally { auth.actor = "actor-a"; auth.pending = null; vi.unstubAllGlobals(); }
});
it("an uncertain write cannot be replayed in another workspace and metadata contains no payload", async () => {
  const entries = new Map<string, string>();
  const attempt = new WriteAttempt({ setItem: (key, value) => entries.set(key, value), removeItem: key => entries.delete(key) });
  const a = createScopedApi({ actorId: "actor-a", workspaceId: "space-a" });
  const b = createScopedApi({ actorId: "actor-a", workspaceId: "space-b" });
  const fetch = vi.fn().mockRejectedValueOnce(new TypeError("lost")).mockResolvedValue(new Response('{"id":"task"}'));
  vi.stubGlobal("fetch", fetch);
  let request = a;
  try {
    await expect(attempt.run(() => request("POST", "/tasks", { title: "private" }, undefined, attempt.requestKey()))).rejects.toThrow();
    const metadata = JSON.parse([...entries.values()][0]);
    expect(metadata).toMatchObject({ actorId: "actor-a", workspaceId: "space-a", path: "/tasks", status: "unknown" });
    expect([...entries.values()].join()).not.toContain("private");
    request = b;
    await expect(attempt.run(() => Promise.resolve())).rejects.toThrow("공간");
    expect(fetch).toHaveBeenCalledTimes(1);
  } finally { attempt.abandon(); vi.unstubAllGlobals(); }
});

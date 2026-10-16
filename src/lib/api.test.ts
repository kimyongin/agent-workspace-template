import { expect, it, vi } from "vitest";
import { api } from "./api.ts";
import { createPagedList, type ListPage } from "../features/collections/paged-list.ts";
import { WriteAttempt } from "./write-attempt.ts";
vi.mock(
  "./supabase.ts",
  () => ({
    supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "fixture-token" } } }) } },
  }),
);

it("HTTP retry sends the original key, target and serialized input after a lost response", async () => {
  const fetch = vi.fn().mockRejectedValueOnce(new TypeError("response lost")).mockResolvedValueOnce(
    new Response(JSON.stringify({ id: "server-issued", version: 4 }), { status: 201 }),
  );
  vi.stubGlobal("fetch", fetch);
  const attempt = new WriteAttempt();
  const input = { title: "original", expected_version: 3, change_tag_ids: ["tag-1"] };
  try {
    const save = async () => {
      await api("PATCH", "/tasks/task-1", input, undefined, attempt.requestKey());
    };
    await expect(attempt.run(save)).rejects.toThrow();
    input.title = "mutated";
    input.expected_version = 4;
    input.change_tag_ids.push("tag-2");
    await attempt.run(async () => {
      await api("POST", "/records", { body: "new" }, undefined, attempt.requestKey());
    });
    expect(fetch.mock.calls[1][0]).toBe(fetch.mock.calls[0][0]);
    expect(fetch.mock.calls[1][1].body).toBe('{"title":"original","expected_version":3,"change_tag_ids":["tag-1"]}');
    expect(fetch.mock.calls[1][1].headers["Idempotency-Key"]).toBe(fetch.mock.calls[0][1].headers["Idempotency-Key"]);
    expect(fetch.mock.calls[1][1].headers["Idempotency-Key"]).toMatch(/^[0-9a-f-]{36}$/);
  } finally {
    vi.unstubAllGlobals();
  }
});

it.each([[201, ""], [200, ""], [201, "null"], [200, "null"]] as const)(
  "%s write replies with body %j retain the request for an exact retry",
  async (status, responseBody) => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(responseBody, { status }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "server-issued", version: 2 }), { status }));
    vi.stubGlobal("fetch", fetch);
    const attempt = new WriteAttempt();
    const save = async () => {
      await api(
        status === 201 ? "POST" : "PATCH",
        "/tasks/task-1",
        { title: "committed" },
        undefined,
        attempt.requestKey(),
      );
    };
    try {
      await expect(attempt.run(save)).rejects.toMatchObject({ code: "network", retryable: true });
      expect(attempt.snapshot().uncertain).toBe(true);
      const key = attempt.requestKey();
      await attempt.run(save);
      expect(fetch.mock.calls[1][1].headers["Idempotency-Key"]).toBe(key);
      expect(fetch.mock.calls[1][1].body).toBe(fetch.mock.calls[0][1].body);
      expect(attempt.snapshot().uncertain).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  },
);

it("nullable reads and successful 204 writes keep their existing empty response behavior", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValueOnce(new Response("", { status: 200 })).mockResolvedValueOnce(
      new Response("null", { status: 200 }),
    ).mockResolvedValueOnce(new Response(null, { status: 204 })),
  );
  try {
    expect(await api("GET", "/tasks/task-1")).toBeNull();
    expect(await api("GET", "/tasks/task-1")).toBeNull();
    const attempt = new WriteAttempt();
    await attempt.run(async () => {
      expect(await api("POST", "/tasks/task-1/delete", { expected_version: 1 }, undefined, attempt.requestKey()))
        .toBeUndefined();
    });
    expect(attempt.snapshot().uncertain).toBe(false);
  } finally {
    vi.unstubAllGlobals();
  }
});

it("long entity reads choose a JSON query body before sending, keep the exact cursor and remain cancellable without a write key", async () => {
  const cursor = "한".repeat(4096), filters = [{ key: "prop_2", operator: "eq", value: "한".repeat(4096) }];
  const query = new URLSearchParams({
    entity_type_id: "kind",
    cursor,
    filters: JSON.stringify(filters),
    sort: JSON.stringify({ key: "prop_2", direction: "asc" }),
    limit: "100",
  });
  const fetch = vi.fn().mockResolvedValue(new Response('{"items":[],"next_cursor":null}'));
  vi.stubGlobal("fetch", fetch);
  const controller = new AbortController();
  try {
    await api("GET", `/entities?${query}`, undefined, controller.signal);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toMatch(/\/entities\/query$/);
    expect(fetch.mock.calls[0][1].method).toBe("POST");
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
      entity_type_id: "kind",
      cursor,
      filters,
      sort: { key: "prop_2", direction: "asc" },
      limit: "100",
    });
    expect(fetch.mock.calls[0][1].headers["Idempotency-Key"]).toBeUndefined();
    expect(fetch.mock.calls[0][1].signal).toBe(controller.signal);
  } finally {
    vi.unstubAllGlobals();
  }
});

it("short entity GET and explicit query POST remain reads, including AbortError without a key", async () => {
  const fetch = vi.fn().mockResolvedValueOnce(new Response('{"items":[]}')).mockResolvedValueOnce(
    new Response('{"items":[]}'),
  ).mockRejectedValueOnce(new DOMException("canceled", "AbortError"));
  vi.stubGlobal("fetch", fetch);
  try {
    await api("GET", "/entities?limit=20");
    expect(fetch.mock.calls[0][1].method).toBe("GET");
    expect(fetch.mock.calls[0][1].body).toBeUndefined();
    await api("POST", "/entities/query", { limit: 20 }, undefined, "unused-key");
    expect(fetch.mock.calls[1][1].headers["Idempotency-Key"]).toBeUndefined();
    const controller = new AbortController();
    const reading = api("GET", `/entities?cursor=${"a".repeat(4000)}`, undefined, controller.signal);
    await Promise.resolve();
    controller.abort();
    await expect(reading).rejects.toMatchObject({ name: "AbortError" });
    expect(fetch.mock.calls.length).toBeLessThanOrEqual(3);
  } finally {
    vi.unstubAllGlobals();
  }
});

it("entity more and page restoration use body cursors while canceled late replies cannot replace accepted rows", async () => {
  const cursor = "a".repeat(17000);
  let release: (value: Response) => void = () => {};
  const fetch = vi.fn().mockResolvedValueOnce(
    new Response(JSON.stringify({ items: [{ id: "first" }], next_cursor: cursor })),
  )
    .mockImplementationOnce(() =>
      new Promise<Response>((resolve) => {
        release = resolve;
      })
    );
  vi.stubGlobal("fetch", fetch);
  const load = (after: string | undefined, signal: AbortSignal) =>
    api<ListPage<{ id: string }>>(
      "GET",
      `/entities?entity_type_id=kind${after ? `&cursor=${encodeURIComponent(after)}` : ""}`,
      undefined,
      signal,
    );
  const list = createPagedList({ load });
  try {
    await list.restore(1);
    list.more();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(fetch.mock.calls[1][1].method).toBe("POST");
    list.cancel();
    release(new Response(JSON.stringify({ items: [{ id: "late" }], next_cursor: null })));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(list.snapshot().page?.items.map((item) => item.id)).toEqual(["first"]);
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ items: [{ id: "first" }], next_cursor: cursor })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [{ id: "last" }], next_cursor: null })));
    const restored = createPagedList({ load });
    await restored.restore(2);
    expect(restored.snapshot().page?.items.map((item) => item.id)).toEqual(["first", "last"]);
    expect(fetch.mock.calls[2][1].method).toBe("GET");
    expect(fetch.mock.calls[3][1].method).toBe("POST");
  } finally {
    list.cancel();
    vi.unstubAllGlobals();
  }
});

it("successful tag writes notify mounted dictionaries, including DELETE 204; reads and failures do not", async () => {
  const target = new EventTarget(), changed = vi.fn();
  target.addEventListener("workspace:tags-changed", changed);
  vi.stubGlobal("window", target);
  vi.stubGlobal(
    "fetch",
    vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "tag", scope: "entity" }), { status: 201 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: "conflict" }), { status: 409 }))
      .mockResolvedValueOnce(new Response("", { status: 200 })),
  );
  const write = async (method: string, path: string, body?: unknown) => {
    const attempt = new WriteAttempt();
    try {
      await attempt.run(() => api(method, path, body, undefined, attempt.requestKey()));
    } finally {
      attempt.abandon();
    }
  };
  try {
    await api("GET", "/tags?scope=entity");
    expect(changed).not.toHaveBeenCalled();
    await write("POST", "/tags", { name: "new", scope: "entity" });
    await write("DELETE", "/tags/tag?expected_version=1");
    expect(changed).toHaveBeenCalledTimes(2);
    await expect(write("PATCH", "/tags/tag", { name: "failed" })).rejects.toThrow();
    await expect(write("PATCH", "/tags/tag", { name: "uncertain" })).rejects.toThrow();
    expect(changed).toHaveBeenCalledTimes(2);
  } finally {
    vi.unstubAllGlobals();
  }
});

it("schema import preview sends the original raw JSON as an authenticated read without a request key", async () => {
  const document = '{"title":"first","title":"duplicate"}';
  const fetch = vi.fn().mockResolvedValue(new Response('{"changed":false}'));
  vi.stubGlobal("fetch", fetch);
  const controller = new AbortController();
  try {
    expect(await api("POST", "/entity-schema-import/preview", { mode: "copy", document }, controller.signal)).toEqual({
      changed: false,
    });
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ mode: "copy", document });
    expect(fetch.mock.calls[0][1].headers["Idempotency-Key"]).toBeUndefined();
    expect(fetch.mock.calls[0][1].headers.authorization).toBe("Bearer fixture-token");
  } finally {
    vi.unstubAllGlobals();
  }
});

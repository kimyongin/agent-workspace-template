import { assertEquals, assertRejects } from "@std/assert";
import * as activity from "../../functions/_shared/core/activity/application.ts";
import type { ActivityRecord, ActivityStore, RecordFilter } from "../../functions/_shared/core/activity/ports.ts";
import * as principles from "../../functions/_shared/core/principles/application.ts";
import type { PrincipleStore } from "../../functions/_shared/core/principles/ports.ts";
import { recordCreate, recordListQuery, recordResult, recordUpdate } from "../../functions/_shared/contracts/record.ts";
import {
  principleCreate,
  principleListQuery,
  type PrincipleResult,
  principleResult,
  principleStatus,
  principleUpdate,
} from "../../functions/_shared/contracts/principle.ts";
import { AppError } from "../../functions/_shared/core/shared/errors.ts";
import { searchInputHash } from "../../functions/_shared/core/shared/operations.ts";
import type { IndexJob } from "../../functions/_shared/core/shared/store.ts";
import { createHttpApp } from "../../functions/_shared/adapters/http/app.ts";
import { activityTools } from "../../functions/_shared/adapters/mcp/activity-tools.ts";
import { principleTools } from "../../functions/_shared/adapters/mcp/principle-tools.ts";
import { toErrorBody } from "../../functions/_shared/adapters/errors.ts";

const actor = { userId: "00000000-0000-4000-8000-000000000001" };
const now = "2026-10-04T03:00:00.000Z";
const tag = "00000000-0000-4000-8000-000000000002";
const missing = "00000000-0000-4000-8000-000000000099";
const content = { title: "판단", summary: "결정 근거", body: "원문" };
const unsupported = () => {
  throw new Error("knowledge fixture: unsupported outbound operation");
};

// Serial storage only. List responses are supplied by the test, not a SQL/RLS/filter implementation.
// Current applied-principle summaries are an outbound read fixture, not business logic.
function fixture() {
  const records = new Map<string, ActivityRecord>();
  const items = new Map<string, PrincipleResult>();
  const jobs: IndexJob[] = [];
  const writes: string[] = [];
  const recordFilters: RecordFilter[] = [];
  const principleFilters: Parameters<PrincipleStore["list"]>[0][] = [];
  let recordRows: ActivityRecord[] = [];
  let principleRows: PrincipleResult[] = [];
  const requests = { lockRequest: unsupported, findRequest: unsupported, saveRequest: unsupported };
  const hydrate = (r: ActivityRecord) => ({
    ...structuredClone(r),
    applied_principles: r.applied_principle_ids.map((id) => {
      const p = items.get(id)!;
      return { id, title: p.title, status: p.status, updated_at: p.updated_at, version: p.version };
    }),
  });
  const enqueueIndex = (job: IndexJob) => {
    jobs.push(structuredClone(job));
    return Promise.resolve();
  };
  const store: ActivityStore = {
    ...requests,
    getTask: unsupported,
    listTasks: unsupported,
    insertTask: unsupported,
    updateTask: unsupported,
    deleteTask: unsupported,
    getRecordSummaries: unsupported,
    occurrenceRecords: unsupported,
    detachRecords: unsupported,
    taskWithResult: () => Promise.resolve(null),
    getRecord: (id) => Promise.resolve(records.has(id) ? hydrate(records.get(id)!) : null),
    insertRecord: (input) => {
      const r: ActivityRecord = {
        ...input,
        id: crypto.randomUUID(),
        tag_ids: input.tag_ids ?? [],
        applied_principle_ids: input.applied_principle_ids ?? [],
        applied_principles: [],
        occurred_at: input.occurred_at ?? now,
        version: 1,
        created_at: now,
        updated_at: now,
      };
      writes.push("record:insert");
      records.set(r.id, r);
      return Promise.resolve(hydrate(r));
    },
    updateRecord: (id, changes) => {
      const r = { ...records.get(id)!, ...changes, version: records.get(id)!.version + 1, updated_at: now };
      writes.push("record:update");
      records.set(id, r);
      return Promise.resolve(hydrate(r));
    },
    deleteRecord: (id) => {
      writes.push("record:delete");
      records.delete(id);
      return Promise.resolve();
    },
    listRecords: (filter) => {
      recordFilters.push(structuredClone(filter));
      return Promise.resolve(structuredClone(recordRows));
    },
    enqueueIndex,
  };
  const principleStore: PrincipleStore = {
    ...requests,
    insert: (input) => {
      const p: PrincipleResult = {
        ...input,
        entity_id: input.entity_id ?? null,
        id: crypto.randomUUID(),
        tag_ids: input.tag_ids ?? [],
        status: "active",
        replaced_by_id: null,
        version: 1,
        created_at: now,
        updated_at: now,
      };
      writes.push("principle:insert");
      items.set(p.id, p);
      return Promise.resolve(structuredClone(p));
    },
    get: (id) => Promise.resolve(structuredClone(items.get(id) ?? null)),
    update: (id, changes) => {
      const p = { ...items.get(id)!, ...changes, version: items.get(id)!.version + 1, updated_at: now };
      writes.push("principle:update");
      items.set(id, p);
      return Promise.resolve(structuredClone(p));
    },
    delete: unsupported,
    list: (filter) => {
      principleFilters.push(structuredClone(filter));
      return Promise.resolve(structuredClone(principleRows));
    },
    enqueueIndex,
  };
  const deps: activity.ActivityDeps = {
    clock: { now: () => new Date(now) },
    uow: {
      run: (received, fn) => {
        assertEquals(received, actor);
        return fn(store);
      },
    },
  };
  const pd: principles.PrincipleDeps = {
    uow: {
      run: (received, fn) => {
        assertEquals(received, actor);
        return fn(principleStore);
      },
    },
  };
  const unused = { uow: { run: unsupported } };
  const app = createHttpApp(
    deps,
    { basePath: "/api", allowedOrigins: [], token: { audience: "authenticated", issuer: "https://auth.invalid" } },
    pd,
    unused,
    unused,
    () => Promise.resolve(actor),
  );
  const tools = [...activityTools(deps), ...principleTools(pd)];
  const call = (name: string, args: Record<string, unknown>) =>
    tools.find((t) => t.name === name)!.handler(args, actor);
  const http = (path: string, method = "GET", body?: unknown) =>
    app.request(`/api${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const snapshot = () => structuredClone({ records: [...records], items: [...items], jobs, writes });
  return {
    deps,
    pd,
    records,
    items,
    jobs,
    writes,
    recordFilters,
    principleFilters,
    tools,
    call,
    http,
    snapshot,
    rows: (r: ActivityRecord[], p: PrincipleResult[]) => {
      recordRows = r;
      principleRows = p;
    },
  };
}

Deno.test("records: actual CRUD guards and content-only indexing preserve optional links", async () => {
  const f = fixture();
  let r = await activity.createRecord(f.deps, actor, recordCreate.parse({ ...content, tag_ids: [tag] }));
  recordResult.parse(r);
  assertEquals([r.task_id, r.occurrence_on], [null, null]);
  assertEquals(await activity.getRecord(f.deps, actor, r.id), r);
  assertEquals(f.jobs, [{ kind: "record", id: r.id, input_hash: await searchInputHash(r) }]);
  for (const patch of [{ title: "새 판단" }, { summary: "새 근거" }]) {
    r = await activity.updateRecord(f.deps, actor, r.id, recordUpdate.parse({ expected_version: r.version, ...patch }));
    assertEquals(f.jobs.at(-1), { kind: "record", id: r.id, input_hash: await searchInputHash(r) });
  }
  r = await activity.updateRecord(
    f.deps,
    actor,
    r.id,
    recordUpdate.parse({
      expected_version: r.version,
      title: r.title,
      summary: r.summary,
      body: "새 원문",
      occurred_at: "2026-10-03T00:00:00.000Z",
    }),
  );
  assertEquals(r.tag_ids, [tag]);
  assertEquals(r.body, "새 원문");
  r = await activity.updateRecord(
    f.deps,
    actor,
    r.id,
    recordUpdate.parse({ expected_version: r.version, tag_ids: [] }),
  );
  assertEquals(r.tag_ids, []);
  assertEquals(f.jobs.length, 3);
  const before = f.snapshot();
  for (
    const mutate of [
      () => activity.updateRecord(f.deps, actor, r.id, recordUpdate.parse({ expected_version: 1, title: "stale" })),
      () => activity.deleteRecord(f.deps, actor, r.id, 1),
    ]
  ) {
    assertEquals((await assertRejects(mutate, AppError)).code, "conflict");
    assertEquals(f.snapshot(), before);
  }
  await activity.deleteRecord(f.deps, actor, r.id, r.version);
  assertEquals((await assertRejects(() => activity.getRecord(f.deps, actor, r.id), AppError)).code, "not_found");
  assertEquals(f.jobs.length, 3);
});

Deno.test("principles: replacement guards, reactivation, and applied current content survive status changes", async () => {
  const f = fixture();
  const p = await principles.createPrinciple(f.pd, actor, principleCreate.parse({ ...content, tag_ids: [tag] }));
  const replacement = await principles.createPrinciple(
    f.pd,
    actor,
    principleCreate.parse({ title: "次", summary: "次" }),
  );
  const r = await activity.createRecord(
    f.deps,
    actor,
    recordCreate.parse({ ...content, applied_principle_ids: [p.id] }),
  );
  for (const replaced_by_id of [p.id, missing]) {
    const before = f.snapshot();
    const e = await assertRejects(
      () =>
        principles.setPrincipleStatus(
          f.pd,
          actor,
          p.id,
          principleStatus.parse({ expected_version: 1, status: "inactive", replaced_by_id }),
        ),
      AppError,
    );
    assertEquals(e.code, "invalid_reference");
    assertEquals(f.snapshot(), before);
  }
  let updated = await principles.setPrincipleStatus(
    f.pd,
    actor,
    p.id,
    principleStatus.parse({ expected_version: 1, status: "inactive", replaced_by_id: replacement.id }),
  );
  assertEquals([updated.status, updated.replaced_by_id], ["inactive", replacement.id]);
  assertEquals((await activity.getRecord(f.deps, actor, r.id)).applied_principles, [
    { id: p.id, title: p.title, status: "inactive", version: 2, updated_at: now },
  ]);
  const before = f.snapshot();
  for (const expected_version of [1, 2]) {
    assertEquals(
      (await assertRejects(() =>
        principles.setPrincipleStatus(
          f.pd,
          actor,
          p.id,
          principleStatus.parse({ expected_version, status: "inactive" }),
        ), AppError)).code,
      "conflict",
    );
    assertEquals(f.snapshot(), before);
  }
  updated = await principles.setPrincipleStatus(
    f.pd,
    actor,
    p.id,
    principleStatus.parse({ expected_version: 2, status: "active" }),
  );
  assertEquals(updated.replaced_by_id, null);
  updated = await principles.updatePrinciple(
    f.pd,
    actor,
    p.id,
    principleUpdate.parse({ expected_version: 3, title: "改", summary: "改", tag_ids: [] }),
  );
  principleResult.parse(updated);
  assertEquals(updated.tag_ids, []);
  assertEquals(f.jobs.at(-1), { kind: "principle", id: p.id, input_hash: await searchInputHash(updated) });
  await principles.updatePrinciple(
    f.pd,
    actor,
    p.id,
    principleUpdate.parse({ expected_version: 4, body: "현재 원칙 본문", applies_when: "결정할 때" }),
  );
  const read = await activity.getRecord(f.deps, actor, r.id);
  assertEquals(read.applied_principles[0], { id: p.id, title: "改", status: "active", version: 5, updated_at: now });
  assertEquals(read.body, content.body);
  assertEquals(read.version, 1);
  await activity.updateRecord(
    f.deps,
    actor,
    r.id,
    recordUpdate.parse({ expected_version: 1, applied_principle_ids: [] }),
  );
  assertEquals((await activity.getRecord(f.deps, actor, r.id)).applied_principles, []);
  assertEquals(f.jobs.length, 4); // Two principles, one record, one content edit; links/status never re-embed.
});

Deno.test("lists: tag/task/date filters and default active reach ports; cursor is bound to filters", async () => {
  const f = fixture();
  const a = await activity.createRecord(f.deps, actor, recordCreate.parse(content));
  const b = await activity.createRecord(f.deps, actor, recordCreate.parse(content));
  const p = await principles.createPrinciple(f.pd, actor, principleCreate.parse(content));
  f.rows([a, b], [p]);
  const filter = { tag_id: tag, task_id: missing, occurred_from: "2026-10-01T00:00:00Z", occurred_to: now, limit: 1 };
  const page = await activity.listRecords(f.deps, actor, recordListQuery.parse(filter));
  assertEquals(page.items, [a]);
  assertEquals(f.recordFilters[0], { ...filter, after: undefined, limit: 2 });
  await activity.listRecords(f.deps, actor, recordListQuery.parse({ ...filter, cursor: page.next_cursor }));
  assertEquals(f.recordFilters[1].after, { at: a.occurred_at, id: a.id });
  const calls = f.recordFilters.length;
  assertEquals(
    (await assertRejects(() =>
      activity.listRecords(
        f.deps,
        actor,
        recordListQuery.parse({ ...filter, tag_id: missing, cursor: page.next_cursor }),
      ), AppError)).code,
    "invalid_input",
  );
  assertEquals(f.recordFilters.length, calls);
  const http = await f.http(`/principles?tag_id=${tag}`);
  assertEquals(http.status, 200);
  assertEquals((await http.json()).items, [p]);
  await f.call("list_principles", { tag_id: tag, status: "inactive", limit: 7 });
  assertEquals(f.principleFilters.map(({ status, tag_id, limit }) => ({ status, tag_id, limit })), [
    { status: "active", tag_id: tag, limit: principleListQuery.parse({}).limit + 1 },
    { status: "inactive", tag_id: tag, limit: 8 },
  ]);
});

Deno.test("HTTP/MCP: record and principle writes share strict input and business error contracts", async () => {
  const f = fixture();
  const response = await f.http("/records", "POST", content);
  assertEquals(response.status, 201);
  const r = recordResult.parse(await response.json());
  const updated = recordResult.parse(await f.call("update_record", { id: r.id, expected_version: 1, summary: "更新" }));
  assertEquals(updated.summary, "更新");
  const p = principleResult.parse(await f.call("create_principle", content));
  const edit = { id: p.id, expected_version: 1, body: "표현 정정" };
  assertEquals(f.tools.find((t) => t.name === "update_principle")!.input.safeParse(edit).success, true);
  assertEquals(principleResult.parse(await f.call("update_principle", edit)).body, "표현 정정");
  const inactive = await f.http(`/principles/${p.id}/deactivate`, "POST", { expected_version: 2 });
  assertEquals(inactive.status, 200);
  assertEquals(principleResult.parse(await inactive.json()).status, "inactive");
  const cases = [
    {
      path: `/records/${r.id}`,
      tool: "update_record",
      body: { expected_version: "2", body: "x" },
      code: "invalid_input",
    },
    {
      path: `/records/${r.id}`,
      tool: "update_record",
      body: { expected_version: 2, task_id: missing },
      code: "invalid_input",
    },
    {
      path: `/records/${r.id}`,
      tool: "update_record",
      body: { expected_version: 2, tag_ids: [tag, tag] },
      code: "invalid_input",
    },
    { path: `/records/${r.id}`, tool: "update_record", body: { expected_version: 1, body: "stale" }, code: "conflict" },
    { path: `/records/${missing}`, tool: "update_record", body: { expected_version: 1, body: "x" }, code: "not_found" },
    {
      path: `/principles/${p.id}`,
      tool: "update_principle",
      body: { expected_version: 2, body: "x", status: "active" },
      code: "invalid_input",
    },
    {
      path: `/principles/${p.id}`,
      tool: "update_principle",
      body: { expected_version: 2, status: "active" },
      code: "invalid_input",
    },
    {
      path: `/principles/${p.id}`,
      tool: "update_principle",
      body: { expected_version: 2 },
      code: "invalid_input",
    },
    {
      path: `/principles/${p.id}`,
      tool: "update_principle",
      body: { expected_version: 1, title: "stale" },
      code: "conflict",
    },
  ];
  for (const c of cases) {
    const before = f.snapshot();
    const target = c.path.split("/").at(-1)!;
    const tool = f.tools.find((t) => t.name === c.tool)!;
    if (c.code === "invalid_input") assertEquals(tool.input.safeParse({ id: target, ...c.body }).success, false);
    const http = await f.http(c.path, "PATCH", c.body);
    const error = await assertRejects(async () => {
      await f.call(c.tool, { id: target, ...c.body });
    }, AppError);
    const expected = toErrorBody(error);
    assertEquals(error.code, c.code);
    assertEquals(http.status, expected.status);
    assertEquals(await http.json(), expected.body);
    assertEquals(f.snapshot(), before);
  }
  const deleted = await f.http(`/records/${r.id}?expected_version=2`, "DELETE");
  assertEquals(deleted.status, 204);
  assertEquals(await deleted.text(), "");
  const statusTool = f.tools.find((t) => t.name === "set_principle_status")!;
  const invalidStatus = { id: p.id, expected_version: 3, status: "active", replaced_by_id: missing };
  assertEquals(statusTool.input.safeParse(invalidStatus).success, false);
  const statusError = await assertRejects(async () => {
    await f.call("set_principle_status", invalidStatus);
  }, AppError);
  const statusHttp = await f.http(`/principles/${p.id}/activate`, "POST", {
    expected_version: 3,
    replaced_by_id: missing,
  });
  assertEquals(await statusHttp.json(), toErrorBody(statusError).body);
  assertEquals(statusHttp.status, 400);
});

Deno.test("principle input boundaries: ToolDef and handlers preserve each original field/object issue once", async () => {
  const f = fixture();
  const p = principleResult.parse(await f.call("create_principle", content));
  const cases: { tool: string; action?: string; body: Record<string, unknown> }[] = [
    { tool: "set_principle_status", action: "deactivate", body: { expected_version: 0 } },
    { tool: "set_principle_status", action: "deactivate", body: {} },
    { tool: "set_principle_status", action: "deactivate", body: { expected_version: 1, extra: true } },
    { tool: "set_principle_status", action: "deactivate", body: { expected_version: 0, extra: true } },
    { tool: "set_principle_status", action: "activate", body: { expected_version: 1, replaced_by_id: missing } },
    { tool: "set_principle_status", action: "activate", body: { expected_version: 0, replaced_by_id: missing } },
    { tool: "update_principle", body: {} },
    { tool: "update_principle", body: { expected_version: 1 } },
    { tool: "update_principle", body: { expected_version: 0 } },
    { tool: "update_principle", body: { expected_version: 0, title: "" } },
    { tool: "update_principle", body: { expected_version: 1, status: "active" } },
    { tool: "update_principle", body: { expected_version: 0, status: "active" } },
  ];
  for (const c of cases) {
    const before = f.snapshot();
    const body = c.action ? { ...c.body, status: c.action === "activate" ? "active" : "inactive" } : c.body;
    const original = (c.action ? principleStatus : principleUpdate).safeParse(body);
    assertEquals(original.success, false);
    if (original.success) throw new Error("expected invalid original contract");
    const expected = toErrorBody(original.error);
    const args = { id: p.id, ...body };
    const derived = f.tools.find((t) => t.name === c.tool)!.input.safeParse(args);
    assertEquals(derived.success, false, JSON.stringify(c));
    if (derived.success) throw new Error("expected invalid ToolDef contract");
    assertEquals(toErrorBody(derived.error), expected);
    const error = await assertRejects(async () => {
      await f.call(c.tool, args);
    }, AppError);
    assertEquals(toErrorBody(error), expected);
    const http = await f.http(
      `/principles/${p.id}${c.action ? `/${c.action}` : ""}`,
      c.action ? "POST" : "PATCH",
      c.body,
    );
    assertEquals(http.status, expected.status);
    assertEquals(await http.json(), expected.body);
    assertEquals(f.snapshot(), before);
  }
  const before = f.snapshot();
  for (
    const body of [null, [], { expected_version: 1, status: "inactive" }, { expected_version: 0, status: "active" }]
  ) {
    const http = await f.http(`/principles/${p.id}/activate`, "POST", body);
    assertEquals(http.status, 400);
    const error = await http.json();
    assertEquals(error.code, "invalid_input");
    if (body && !Array.isArray(body)) {
      assertEquals(
        error.fields.some((field: { path: string }) => field.path === "status"),
        true,
      );
    }
    assertEquals(f.snapshot(), before);
  }
  const badId = "not-a-uuid";
  const http = await f.http(`/principles/${badId}/deactivate`, "POST", { expected_version: 1 });
  assertEquals(http.status, 404);
  for (const expected_version of [1, 0]) {
    const e = await assertRejects(async () => {
      await f.call("set_principle_status", { id: badId, expected_version, status: "inactive" });
    }, AppError);
    assertEquals(e.code, "not_found");
  }
  assertEquals(f.snapshot(), before);
  const args = { id: p.id, expected_version: 1, status: "inactive" };
  assertEquals(f.tools.find((t) => t.name === "set_principle_status")!.input.safeParse(args).success, true);
  assertEquals(principleResult.parse(await f.call("set_principle_status", args)).status, "inactive");
  const active = await f.http(`/principles/${p.id}/activate`, "POST", { expected_version: 2 });
  assertEquals(active.status, 200);
  assertEquals(principleResult.parse(await active.json()).status, "active");
});

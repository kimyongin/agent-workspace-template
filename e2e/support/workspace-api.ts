import { fixtureWorkspaceId } from "./workspace-scope.ts";
import { entitySummary } from "../../supabase/functions/_shared/contracts/entity.ts";
import { entityId } from "../../supabase/functions/_shared/contracts/entity-identity.ts";
import type { Page } from "@playwright/test";
import { recordDisplayText } from "../../supabase/functions/_shared/contracts/record-display.ts";
import {
  base,
  entity,
  fixtureSchema,
  fixtureType,
  fixtureIdentity,

  record,
  stamp,
  task,
  type WorkspaceRows,
} from "./workspace-data.ts";
type FakeRow = { id: string; version: number; body?: string; [key: string]: unknown };
type ReadScope = { workspaceId?: string; entityId?: string; taskId?: string };
type ReadTarget = ReadScope & { kind: keyof WorkspaceRows; id?: string; page?: number };
type ReadFailure = { status?: number; message?: string; once?: boolean };
export type FakeOptions = { failWrite?: "unknown" | "conflict"; hold?: boolean; pageSize?: number; workspaces?: Record<string, { name: string; rows: WorkspaceRows }> };
/** Shared browser adapter only: real consistency, authorization and workflow rules are integration-tested. */
export async function installWorkspaceApi(
  page: Page,
  apiOrigin: string,
  rows: WorkspaceRows,
  options: FakeOptions = {},
) {
  const workspaces = options.workspaces ?? { [fixtureWorkspaceId]: { name: "테스트 공간", rows } };
  const requests: { method: string; path: string; workspaceId: string | null }[] = [];
  const writes: {
      method: string;
      workspaceId: string;
      path: string;
      body: Record<string, unknown>;
      requestKey?: string;
      params: URLSearchParams;
    }[] = [],
    searches: Record<string, unknown>[] = [],
    reads: string[] = [],
    errors: string[] = [];
  const plans = new Map<string, unknown[][]>();
  const failures: { target: ReadTarget; options: ReadFailure }[] = [];
  const holds: { target: ReadTarget; start: () => void; wait: Promise<void>; finish: () => void }[] = [];
  const scopeKey = (kind: string, scope: ReadScope) =>
    JSON.stringify([scope.workspaceId ?? null, kind, scope.entityId ?? null, scope.taskId ?? null]);
  const matches = (target: ReadTarget, kind: string, key: string | undefined, scope: ReadScope, page: number) =>
    target.kind === kind && (target.workspaceId === undefined || target.workspaceId === scope.workspaceId) && (target.id === undefined || target.id === key) &&
    (target.page === undefined || !key && target.page === page) &&
    (target.entityId === undefined || target.entityId === scope.entityId) &&
    (target.taskId === undefined || target.taskId === scope.taskId);
  let sequence = 20, failed = false, release = () => {}, started = () => {};
  const pending = new Promise<void>((r) => {
    started = r;
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (e) => {
    if (/one blocker|Maximum update depth/.test(e.text())) errors.push(e.text());
  });
  page.on("request", (request) => {
    if (request.url().startsWith(apiOrigin + "/api/")) reads.push(request.url());
  });
  await page.route(apiOrigin + "/api/**", async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      parts = url.pathname.replace("/api/", "").split("/"),
      [kind, encodedKey, action] = parts,
      key = encodedKey ? decodeURIComponent(encodedKey) : undefined,
      method = req.method();
    const workspaceId = req.headers()["x-workspace-id"] ?? null;
    requests.push({ method, path: url.pathname, workspaceId });
    if (kind === "workspaces" && method === "GET") {
      if (key === "deleted") return route.fulfill({ json: { items: [] } });
      const workspace = key ? workspaces[key] : null;
      if (!key) return route.fulfill({ json: { items: Object.entries(workspaces).map(([id, value]) => ({ id, name: value.name, deleted_at: null, can_manage: true })) } });
      if (!workspace) return route.fulfill({ status: 404, json: { code: "not_found", message: "공간을 찾을 수 없습니다." } });
      if (action === "lifecycle") return route.fulfill({ json: { workspace: { id: key, name: workspace.name, deleted_at: null, lifecycle_generation: 1 } } });
      if (action === "membership") return route.fulfill({ json: { workspace: { id: key, name: workspace.name, deleted_at: null }, membership_version: 1 } });
      if (action === "grant-targets") return route.fulfill({ json: { items: [{ id: fixtureType.id, label: fixtureType.label }] } });
      if (action === "members" || action === "invitations") return route.fulfill({ json: { items: [] } });
      return route.fulfill({ json: { workspace: { id: key, name: workspace.name, deleted_at: null }, membership_version: 1, grants: [{ target_kind: "settings", target_id: "*", access: "write" }], can_manage: true } });
    }
    if (!workspaceId) return route.fulfill({ status: 400, json: { code: "validation", message: "공간이 필요합니다." } });
    if (!workspaces[workspaceId]) return route.fulfill({ status: 404, json: { code: "not_found", message: "공간을 찾을 수 없습니다." } });
    const storage = workspaces[workspaceId].rows as unknown as Record<string, FakeRow[]>;
    const body = (req.postDataJSON() ?? {}) as Record<string, unknown>;
    const scope = {
      workspaceId,
      entityId: url.searchParams.get("entity_id") ?? undefined,
      taskId: url.searchParams.get("task_id") ?? undefined,
    };
    const plan = plans.get(scopeKey(kind, scope)) ?? plans.get(scopeKey(kind, {}));
    const cursor = url.searchParams.get("cursor");
    const pageNumber = plan
      ? Number(cursor?.replace("page:", "") ?? 1)
      : Math.floor(Number(cursor ?? 0) / (options.pageSize ?? 20)) + 1;
    const holdIndex = method === "GET" ? holds.findIndex((h) => matches(h.target, kind, key, scope, pageNumber)) : -1;
    const held = holdIndex < 0 ? undefined : holds.splice(holdIndex, 1)[0];
    const failure = method === "GET"
      ? failures.find((f) => matches(f.target, kind, key, scope, pageNumber))
      : undefined;
    if (failure && failure.options.once !== false) failures.splice(failures.indexOf(failure), 1);
    const reply = async (data: unknown, status = 200) => {
      // Capture at request time so a delayed read cannot silently become a newer response.
      const captured = structuredClone(data);
      try {
        if (held) {
          held.start();
          await held.wait;
        }
        return await route.fulfill(
          failure
            ? {
              status: failure.options.status ?? 503,
              json: { code: "internal", message: failure.options.message ?? "fixture read failed" },
            }
            : { status, json: captured },
        );
      } catch (error) {
        if (!req.failure()) throw error;
      } finally {
        held?.finish();
      }
    };
    if (kind === "entity-relation-definitions") return reply({items:[],next_cursor:null});
    if (kind === "entities" && action === "links" && method === "GET") return reply({ items: [], next_cursor: null });
    if (kind === "entity-types") return reply(key ? action === "schema" ? fixtureSchema : action === "identity" ? fixtureIdentity(key) : fixtureType : { items: [fixtureType], next_cursor: null });
    if (kind === "settings" && key === "business") {
      return reply({
        versions: { record_templates: 0 },
        settings: { record_templates: {} },
      });
    }
    if (kind === "records" && key === "prepare") {
      const model = String(body.model),
        target = (storage[model === "entity" ? "entities" : `${model}s`] ?? []).find((row) =>
          row.id === body.target_id
        );
      const input = body.input as Record<string, unknown> ?? {}, facts = { ...target, ...input };
      const labels: Record<string, string> = {
        create: "등록",
        update: "수정",
        delete: "삭제",
        restore: "복원",
        stop: "중단",
        resume: "재개",
      };
      return reply({
        change_note: body.change_note ??
          `${(facts.properties as Record<string, unknown> | undefined)?.prop_1 ?? facts.title ?? "항목"} ${
            labels[String(body.action)]
          }`,
        change_tag_ids: body.change_tag_ids ?? [],
        missing_tag_ids: [],
        settings_version: 0,
        prepared_input: input,
      });
    }
    if (kind === "search") {
      searches.push(body);
      const selected = String((body.kinds as string[])[0]) + "s";
      return reply({
        items: (storage[selected] ?? []).map((r) => ({
          id: r.id,
          kind: selected.slice(0, -1),
          title: selected === "records" ? recordDisplayText(String(r.body ?? "")) : r.title,
          snippet: r.body,
          snippet_start: 0,
          snippet_end: Array.from(String(r.body ?? "")).length,
          at: stamp,
          tag_ids: r.tag_ids ?? [],
          path: `/${selected}/${encodeURIComponent(r.id)}`,
          match: "keyword",
          index_state: "pending",
        })),
        next_cursor: null,
        anchor_page: null,
        search_state: body.mode === "auto" ? "keyword_fallback" : "ok",
        semantic_coverage: { pending: 1, excluded: 0, failed: 0 },
      });
    }
    if (!storage[kind]) {
      return reply({ code: "invalid_input", message: `Unexpected fixture endpoint ${url.pathname}` }, 400);
    }
    if (kind === "records" && method === "POST" && !key) {
      return reply({ code: "not_found", message: "수행 결과는 할 일에서 작성합니다." }, 404);
    }
    if (method === "GET") {
      if (key) {
        const found = storage[kind].find((r) => r.id === key);
        return found ? reply(found) : reply({ code: "not_found", message: "삭제된 자료" }, 404);
      }
      if (plan) {
        return reply({
          items: kind === "entities" ? (plan[pageNumber - 1] ?? []).map((row) => entitySummary.parse(row)) : plan[pageNumber - 1] ?? [],
          next_cursor: pageNumber < plan.length ? "page:" + (pageNumber + 1) : null,
        });
      }
      let items = storage[kind];
      if (kind === "entities") {
        const typeId = url.searchParams.get("entity_type_id"), keyword = url.searchParams.get("keyword")?.toLowerCase();
        items = items.filter((row) => !row.deleted_at && (!typeId || row.entity_type_id === typeId) && (!keyword || String(row.title).toLowerCase().includes(keyword)));
      }
      if (kind === "tags") items = items.filter((r) => r.scope === (url.searchParams.get("scope") ?? "record"));

      if (url.searchParams.get("entity_id") && (kind === "entities" || kind === "tasks" || kind === "records")) {
        const parent = url.searchParams.get("entity_id");
        items = items.filter((r) => kind === "records" ? r.entity_id === parent : kind === "tasks" ?
          (r.entity_ids as string[]).includes(parent!) : r.id === parent);
      }
      if (kind === "records" && url.searchParams.get("task_id")) {
        items = items.filter((r) => r.task_id === url.searchParams.get("task_id"));
      }
      if (kind === "records" && url.searchParams.get("record_kind")) {
        items = items.filter((r) => r.record_kind === url.searchParams.get("record_kind"));
      }
      const offset = Number(url.searchParams.get("cursor") ?? 0), size = options.pageSize ?? Math.max(1, items.length);
      return reply({
        items: kind === "entities" ? items.slice(offset, offset + size).map((row) => entitySummary.parse(row)) : items.slice(offset, offset + size),
        next_cursor: items.length > offset + size ? String(offset + size) : null,
      });
    }
    writes.push({ workspaceId,
      method,
      path: url.pathname,
      body,
      requestKey: req.headers()["idempotency-key"],
      params: url.searchParams,
    });
    if (options.hold) {
      started();
      await new Promise<void>((r) => {
        release = r;
      });
      options.hold = false;
    }
    if (options.failWrite && !failed) {
      failed = true;
      return options.failWrite === "unknown"
        ? route.abort("connectionreset")
        : reply({ code: "conflict", message: "다른 곳에서 수정했습니다." }, 409);
    }
    if (kind === "tasks" && method === "POST" && (action === "complete" || action === "occurrences" && parts[4] === "records")) {
      const target = storage.tasks.find((r) => r.id === key);
      if (!target) return reply({ code: "not_found", message: "할 일 없음" }, 404);
      const saved = { ...record(sequence++), ...body, entity_id: null, task_id: key!, record_kind: "result",
        occurrence_on: action === "occurrences" ? parts[3] : null };
      delete (saved as Record<string, unknown>).expected_version;
      storage.records.unshift(saved);
      if (action === "complete") Object.assign(target, { status: "done", completed_at: stamp,
        result_record_id: saved.id, result_record: { id: saved.id, body: saved.body }, version: target.version + 1 });
      return reply(action === "complete" ? target : saved, action === "complete" ? 200 : 201);
    }
    if (method === "DELETE" || action === "delete") {
      if (kind === "entities") {
        const found = storage.entities.find((row) => row.id === key);
        if (found) Object.assign(found, { deleted_at: stamp, version: found.version + 1 });
      } else storage[kind] = storage[kind].filter((r) => r.id !== key);
      return route.fulfill({ status: 204 });
    }
    if (method === "POST" && !key) {
      const saved: FakeRow = {
        ...(kind === "entities"
          ? entity(sequence++)
          : kind === "tasks"
          ? task(sequence++)
          : kind === "records"
          ? record(sequence++)
          : base(sequence++, "")),
        ...body,
      };
      if (kind === "entities") {
        const source = String(body.source ?? "app"), external_id = String(body.external_id ?? crypto.randomUUID());
        Object.assign(saved, {
          source,
          external_id,
          id: entityId(source, String(body.entity_type_id ?? fixtureType.id), external_id),
          title: (body.properties as Record<string, unknown>)?.prop_1 ?? saved.title,
          display_properties: body.properties ?? saved.display_properties,
        });
      }
      storage[kind].unshift(saved);
      return reply(saved, 201);
    }
    const found = storage[kind].find((r) => r.id === key);
    if (!found) return reply({ code: "not_found", message: "자료 없음" }, 404);
    const previousProperties = found.properties;
    Object.assign(found, body, { version: found.version + 1 });
    if (kind === "entities" && body.properties) {
      found.properties = { ...(previousProperties as object), ...(body.properties as object) };
      found.title = (found.properties as Record<string, unknown>).prop_1;
      found.display_properties = { prop_1: found.title, prop_2: (found.properties as Record<string, unknown>).prop_2 };
    }
    if (kind === "tasks" && body.entity_ids) {
      found.entity_context = (body.entity_ids as string[]).map((id) => ({
        id,
        title: storage.entities.find((e) => e.id === id)?.title ?? "자료",
        type: storage.entities.find((e) => e.id === id)?.type,
        schema_version: storage.entities.find((e) => e.id === id)?.schema_version,
        source: "selection",
        captured_at: stamp,
      }));
    }
    return reply(found);
  });
  return {
    rows,
    workspaces,
    requests,
    writes,
    searches,
    reads,
    errors,
    pending,
    release: () => release(),
    listPages<K extends keyof WorkspaceRows>(kind: K, pages: WorkspaceRows[K][], scope: ReadScope = {}) {
      plans.set(scopeKey(kind, scope), pages);
    },
    failRead(target: ReadTarget, options: ReadFailure = {}) {
      const failure = { target, options };
      failures.push(failure);
      return () => {
        const index = failures.indexOf(failure);
        if (index >= 0) failures.splice(index, 1);
      };
    },
    holdRead(target: ReadTarget) {
      let start!: () => void, release!: () => void, finish!: () => void;
      const started = new Promise<void>((resolve) => {
        start = resolve;
      });
      const wait = new Promise<void>((resolve) => {
        release = resolve;
      });
      const finished = new Promise<void>((resolve) => {
        finish = resolve;
      });
      holds.push({ target, start, wait, finish });
      return { started, release, finished };
    },
  };
}

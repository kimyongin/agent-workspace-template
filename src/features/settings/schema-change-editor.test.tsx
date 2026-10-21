// @vitest-environment happy-dom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation, useNavigate } from "react-router";
import { afterEach, expect, test, vi } from "vitest";
import type { Session } from "@supabase/supabase-js";
import type { EntitySchemaMigration } from "@contracts/entity-schema-migration.ts";
import type { EntitySchemaChange } from "@contracts/entity-schema-change.ts";
import { type EntitySchemaVersion, type EntityType, initialEntityDefinition } from "@contracts/entity-type.ts";
import { ApiSessionContext } from "../../lib/api-context.tsx";
import { AuthContext } from "../auth/auth-context.ts";
import { WorkspaceRouteContext } from "../../lib/workspace-route.tsx";
import { WorkspaceCapabilitiesContext } from "../workspaces/workspace-context.tsx";
import { type EditState, useSchemaChangeEditor } from "./schema-change-editor.ts";
import { renderEntityTitle } from "@contracts/entity-title-template.ts";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const type = { id: "kind", label: "재료", schema_version: 2 } as EntityType;
const definition = { type_id: type.id, schema_version: 2, ...initialEntityDefinition("이름") } as EntitySchemaVersion;
const plan: EntitySchemaChange = {
  id: "change",
  type_id: type.id,
  source_schema_version: 2,
  source_template_fingerprint: "template",
  version: 3,
  status: "ready",
  change_kind: "migration_required",
  edits: [],
  migration: { rules: [], overrides: [] },
  executable: true,
  reservations: {},
  target: definition,
  diff: [],
  fingerprint: "reviewed-values",
  analysis: {
    id: "analysis",
    change_version: 3,
    status: "succeeded",
    total: 1,
    snapshot_fingerprint: "snapshot",
    definition_fingerprint: "definition",
    processed: 1,
    failed: 0,
    changed: 1,
    unchanged: 0,
    removed: 0,
    replacements: 0,
    retryable: false,
    failure_reason: null,
    errors: [],
    created_at: "2026-10-19T00:00:00Z",
  },
  created_at: "2026-10-19T00:00:00Z",
  updated_at: "2026-10-19T00:00:00Z",
};
const session = { user: { id: "actor" }, access_token: "test-token" } as Session;
const sessionReader = async () => ({ data: { session } });
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(() => root!.unmount());
  root = undefined;
  document.body.innerHTML = "";
  sessionStorage.clear();
  vi.unstubAllGlobals();
});
async function openEditor(sourceDefinition = definition) {
  let current!: ReturnType<typeof useSchemaChangeEditor>;
  let path = "";
  const config = {
    jobs: [] as EntitySchemaMigration[],
    workspace: "space",
    visible: true,
    access: "write" as "read" | "write",
  };
  function Editor({ onState }: { onState: (state: EditState) => void }) {
    const location = useLocation(), navigate = useNavigate();
    current = useSchemaChangeEditor({
      type,
      definition: sourceDefinition,
      disabled: false,
      selectionSearch: location.search,
      onApplied: async () => "",
      onState,
      onFieldKeysChanged: () => {},
      onInvalidField: () => {},
      onReviewed: () => {},
      onNavigate: navigate,
      jobs: config.jobs,
    });
    return null;
  }
  function Screen() {
    const location = useLocation();
    const [protection, setProtection] = useState<EditState>({ dirty: false, busy: false, uncertain: false });
    path = location.pathname + location.search;
    return (
      <>
        {config.visible && <Editor onState={setProtection} />}
        <output>
          {protection.uncertain
            ? "응답 확인 필요"
            : protection.busy
            ? "처리 중"
            : protection.dirty
            ? "편집 중"
            : "준비"}
        </output>
      </>
    );
  }
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const render = () =>
    root!.render(
      <AuthContext.Provider
        value={{
          session,
          loading: false,
          savePreferences: async () => {
            throw new Error("unused");
          },
        }}
      >
        <ApiSessionContext.Provider value={sessionReader}>
          <WorkspaceRouteContext.Provider value={config.workspace}>
            <WorkspaceCapabilitiesContext.Provider
              value={{
                workspace: { id: config.workspace, name: "공간", deleted_at: null },
                grants: [{ target_kind: "settings", target_id: "*", access: config.access }],
                can_manage: true,
                membership_version: 1,
              }}
            >
              <MemoryRouter initialEntries={["/settings/entity-types/kind?change_id=change&keep=1"]}>
                <Screen />
              </MemoryRouter>
            </WorkspaceCapabilitiesContext.Provider>
          </WorkspaceRouteContext.Provider>
        </ApiSessionContext.Provider>
      </AuthContext.Provider>,
    );
  await act(async () => render());
  return {
    editor: () => current,
    path: () => path,
    update: async (next: Partial<typeof config>) => {
      Object.assign(config, next);
      await act(async () => render());
    },
  };
}
function json(value: unknown) {
  return new Response(JSON.stringify(value), { status: 200 });
}

test("검토된 속성 변경안은 값 변환을 접수하고 같은 변경안·접수 작업의 주소로 이동한다", async () => {
  const submissions: { input: unknown; key: string | null; workspace: string | null }[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    if (init.method === "POST") {
      submissions.push({
        input: JSON.parse(String(init.body)),
        key: new Headers(init.headers).get("Idempotency-Key"),
        workspace: new Headers(init.headers).get("X-Workspace-Id"),
      });
      return json({ job_id: "job", type_id: type.id, change_id: plan.id });
    }
    return json(url.endsWith("/change") ? plan : { items: [], next_before: null });
  });
  const screen = await openEditor();
  await act(async () => {
    await screen.editor().actions.history?.run?.();
  });
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });
  expect({ submissions, path: screen.path() }).toEqual({
    submissions: [{
      input: {
        expected_change_version: 3,
        expected_schema_version: 2,
        analysis_id: "analysis",
        fingerprint: "reviewed-values",
      },
      key: expect.stringMatching(/^[0-9a-f-]{36}$/),
      workspace: "space",
    }],
    path: "/settings/entity-types/kind?change_id=change&keep=1&job_id=job",
  });
});

test("값 변환 접수의 응답 불명은 초안을 잠그고 변경안 최신 조회 뒤에도 원래 요청으로 확인한다", async () => {
  const requests: { body: string; key: string | null }[] = [];
  let serverPlan = plan;
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    if (init.method === "POST") {
      requests.push({ body: String(init.body), key: new Headers(init.headers).get("Idempotency-Key") });
      if (requests.length === 1) throw new TypeError("response lost");
      return json({ job_id: "reconfirmed", type_id: type.id, change_id: plan.id });
    }
    return json(url.endsWith("/change") ? serverPlan : { items: [], next_before: null });
  });
  const screen = await openEditor();
  await act(async () => {
    await screen.editor().actions.history?.run?.();
  });
  expect(screen.editor().actions.history?.label).toBe("같은 접수 요청 다시 확인");
  expect(document.querySelector("output")?.textContent).toBe("응답 확인 필요");
  expect(screen.editor().view.inputsDisabled).toBe(true);
  await act(async () =>
    screen.editor().editField("prop_1", { ...definition.schema.properties.prop_1, title: "바뀌면 안 됨" })
  );
  expect(screen.editor().view.draft.schema.properties.prop_1.title).toBe("이름");
  serverPlan = { ...plan, version: 4, fingerprint: "different" };
  await act(async () => screen.editor().refreshPlan());
  await act(async () => {
    await screen.editor().actions.history?.run?.();
  });
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });
  expect({ first: JSON.parse(requests[0].body), replay: requests[1], path: screen.path() }).toEqual({
    first: {
      expected_change_version: 3,
      expected_schema_version: 2,
      analysis_id: "analysis",
      fingerprint: "reviewed-values",
    },
    replay: requests[0],
    path: "/settings/entity-types/kind?change_id=change&keep=1&job_id=reconfirmed",
  });
});

test("자기 값 변환이 완료되면 변경안을 확인하며 편집 중인 입력은 유지한다", async () => {
  let serverPlan = plan;
  vi.stubGlobal(
    "fetch",
    async (url: string) => json(url.endsWith("/change") ? serverPlan : { items: [], next_before: null }),
  );
  const screen = await openEditor();
  await act(async () =>
    screen.editor().editField("prop_1", { ...definition.schema.properties.prop_1, title: "내 초안" })
  );
  serverPlan = { ...plan, status: "applied", version: 5 };
  await screen.update({
    jobs: [
      { id: "job", change_id: "change", type_id: type.id, version: 2, status: "succeeded" } as EntitySchemaMigration,
    ],
  });
  expect({
    status: screen.editor().view.plan?.status,
    title: screen.editor().view.draft.schema.properties.prop_1.title,
    dirty: screen.editor().view.dirty,
  }).toEqual({ status: "applied", title: "내 초안", dirty: true });
});

test("설정 쓰기 권한을 잃으면 표시된 이전 접수 대신 현재 읽기 권한으로 접수를 막는다", async () => {
  const writes: string[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    if (init.method !== "GET") writes.push(url);
    return json(url.endsWith("/change") ? plan : { items: [], next_before: null });
  });
  const screen = await openEditor();
  expect(screen.editor().actions.history?.disabled).toBe(false);
  await screen.update({ access: "read" });
  await act(async () => {
    await screen.editor().actions.history?.run?.();
  });
  expect({ disabled: screen.editor().actions.history?.disabled, writes, path: screen.path() }).toEqual({
    disabled: true,
    writes: [],
    path: "/settings/entity-types/kind?change_id=change&keep=1",
  });
});

test("접수 확인과 화면 이동 사이 공간이 바뀌면 이전 공간의 예약된 이동을 적용하지 않는다", async () => {
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.stubGlobal(
    "fetch",
    async (url: string, init: RequestInit) =>
      json(
        init.method === "POST"
          ? { job_id: "old-job", type_id: type.id, change_id: plan.id }
          : url.endsWith("/change")
          ? plan
          : { items: [], next_before: null },
      ),
  );
  const screen = await openEditor();
  await act(async () => {
    await screen.editor().actions.history?.run?.();
  });
  await screen.update({ workspace: "other-space" });
  await act(async () => {
    for (const frame of frames) frame(0);
  });
  expect(screen.path()).toBe("/settings/entity-types/kind?change_id=change&keep=1");
});

test("접수 응답 불명 중에는 원래 변환 규칙과 행 보완 입력도 변경하지 않는다", async () => {
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    if (init.method === "POST") throw new TypeError("response lost");
    return json(url.endsWith("/change") ? plan : { items: [], next_before: null });
  });
  const screen = await openEditor();
  await act(async () => {
    await screen.editor().actions.history?.run?.();
  });
  await act(async () =>
    screen.editor().editMigration({
      rules: [{ op: "fill", key: "prop_1", value: "다른 값", include_null: false }],
      overrides: [],
    })
  );
  expect(screen.editor().view.migration).toEqual({ rules: [], overrides: [] });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const completedJob = (version: number): EntitySchemaMigration =>
  ({ id: "job", change_id: "change", type_id: type.id, version, status: "succeeded" }) as EntitySchemaMigration;

test("새 완료를 확인한 뒤 늦은 이전 완료와 같은 완료의 재등장은 현재 변경안을 되돌리지 않는다", async () => {
  const older = deferred<Response>();
  let selectedResponse: Response | Promise<Response> | undefined;
  vi.stubGlobal("fetch", async (url: string) => {
    if (!url.endsWith("/change")) return json({ items: [], next_before: null });
    return selectedResponse ?? json(plan);
  });
  const screen = await openEditor();
  selectedResponse = older.promise;
  await screen.update({ jobs: [completedJob(2)] });
  selectedResponse = json({ ...plan, status: "applied", version: 6 });
  await screen.update({ jobs: [completedJob(3)] });
  await act(async () => older.resolve(json({ ...plan, status: "ready", version: 4 })));
  selectedResponse = json({ ...plan, status: "ready", version: 7 });
  await screen.update({ jobs: [completedJob(3)] });
  expect({ status: screen.editor().view.plan?.status, version: screen.editor().view.plan?.version }).toEqual({
    status: "applied",
    version: 6,
  });
});

test("자기 변경안 이외의 완료나 진행 중인 작업은 현재 검토를 완료 상태로 바꾸지 않는다", async () => {
  let serverPlan = plan;
  vi.stubGlobal(
    "fetch",
    async (url: string) => json(url.endsWith("/change") ? serverPlan : { items: [], next_before: null }),
  );
  const screen = await openEditor();
  serverPlan = { ...plan, status: "applied", version: 6 };
  await screen.update({ jobs: [{ ...completedJob(2), change_id: "another-change" }] });
  await screen.update({ jobs: [{ ...completedJob(2), type_id: "another-kind" }] });
  await screen.update({ jobs: [{ ...completedJob(2), status: "preparing" }] });
  expect(screen.editor().view.plan?.status).toBe("ready");
});

test("완료 뒤 변경안 조회가 실패해도 초안을 보존하고 같은 변경안을 다시 확인할 수 있다", async () => {
  let unavailable = false;
  vi.stubGlobal("fetch", async (url: string) => {
    if (!url.endsWith("/change")) return json({ items: [], next_before: null });
    return unavailable
      ? new Response(JSON.stringify({ code: "unavailable", message: "최신 변경안 조회 실패" }), { status: 503 })
      : json(plan);
  });
  const screen = await openEditor();
  await act(async () =>
    screen.editor().editField("prop_1", { ...definition.schema.properties.prop_1, title: "잃으면 안 되는 초안" })
  );
  unavailable = true;
  await screen.update({ jobs: [completedJob(2)] });
  expect(screen.editor().view.error).toBe("최신 변경안 조회 실패");
  unavailable = false;
  await act(async () => screen.editor().refreshPlan());
  expect({
    error: screen.editor().view.error,
    title: screen.editor().view.draft.schema.properties.prop_1.title,
    dirty: screen.editor().view.dirty,
    sync: screen.editor().view.planSyncNeeded,
  }).toEqual({
    error: "",
    title: "잃으면 안 되는 초안",
    dirty: true,
    sync: false,
  });
});

test.each(["workspace", "unmount"] as const)(
  "접수 응답이 늦는 동안 %s 전환이 있으면 이전 접수로 이동하지 않는다",
  async (transition) => {
    const accepted = deferred<Response>();
    vi.stubGlobal(
      "fetch",
      async (url: string, init: RequestInit) =>
        init.method === "POST"
          ? accepted.promise
          : json(url.endsWith("/change") ? plan : { items: [], next_before: null }),
    );
    const screen = await openEditor();
    let starting: void | Promise<void>;
    await act(async () => {
      starting = screen.editor().actions.history?.run?.();
    });
    await screen.update(transition === "workspace" ? { workspace: "another-space" } : { visible: false });
    await act(async () => {
      accepted.resolve(json({ job_id: "old-job", type_id: type.id, change_id: plan.id }));
      await starting;
    });
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    expect(screen.path()).toBe("/settings/entity-types/kind?change_id=change&keep=1");
  },
);

test("연속 삭제와 역순 복원은 전체 행 순서와 각 항목의 편집값을 보존한다", async () => {
  const source = structuredClone(definition);
  source.schema.properties.prop_3 = { type: "string", title: "부서", "x-order": 30 };
  source.schema.properties.prop_4 = { type: "string", title: "연락처", "x-order": 40 };
  source.schema.required.push("prop_3");
  vi.stubGlobal(
    "fetch",
    async (url: string) => json(url.endsWith("/change") ? { ...plan, status: "draft", target: source } : { items: [] }),
  );
  const screen = await openEditor(source);
  await act(() => screen.editor().editField("prop_3", { ...source.schema.properties.prop_3, title: "부서 초안" }));
  await act(() => screen.editor().removeField("prop_3"));
  await act(() => screen.editor().removeField("prop_4"));
  expect(screen.editor().view.fieldOrder).toEqual(["prop_1", "prop_2", "prop_3", "prop_4"]);
  await act(() => screen.editor().restoreField("prop_4"));
  expect(screen.editor().view.fieldOrder).toEqual(["prop_1", "prop_2", "prop_3", "prop_4"]);
  await act(() => screen.editor().restoreField("prop_3"));
  expect(screen.editor().view.draft.schema.properties.prop_3.title).toBe("부서 초안");
  expect(screen.editor().view.draft.schema.required).toContain("prop_3");
  expect(screen.editor().view.fieldOrder).toEqual(["prop_1", "prop_2", "prop_3", "prop_4"]);
});

test("저장된 삭제의 복원과 전체 취소는 현재 제목 템플릿과 저장 기준을 유지한다", async () => {
  const source = structuredClone(definition);
  source.schema.properties.prop_3 = { type: "string", title: "새 이름", "x-order": 30, minLength: 1 };
  source.schema.required.push("prop_3");
  const target = structuredClone(source);
  target.schema["x-title-template"] = "$prop_3$";
  delete target.schema.properties.prop_1;
  target.schema.required = target.schema.required.filter((key) => key !== "prop_1");
  vi.stubGlobal(
    "fetch",
    async (url: string) => json(url.endsWith("/change") ? { ...plan, status: "draft", target } : { items: [] }),
  );
  const screen = await openEditor(source);
  await act(() => screen.editor().restoreField("prop_1"));
  await act(() =>
    screen.editor().editField("prop_1", {
      ...screen.editor().view.draft.schema.properties.prop_1,
      title: "취소할 초안",
    })
  );
  await act(() => screen.editor().removeField("prop_1"));
  await act(() => screen.editor().cancelEditing());
  expect(screen.editor().view.removedFields[0].field.title).toBe("이름");
  await act(() => screen.editor().restoreField("prop_1"));
  expect(screen.editor().view.draft.schema.properties.prop_1.title).toBe("이름");
  expect(screen.editor().view.draft.schema["x-title-template"]).toBe("$prop_3$");
});

test("과거 예약 속성의 제목 템플릿은 취소 후 새 검토에서도 client_ref로 전송하고 새 발급 키를 반영한다", async () => {
  const target = structuredClone(definition);
  target.schema.properties.prop_3 = { type: "string", title: "지역", "x-order": 30 };
  target.schema["x-title-template"] = "$prop_1$ / ${prop_3$} $$";
  const retained = {
    ...plan,
    status: "stale" as const,
    source_schema_version: 1,
    reservations: { region: "prop_3" },
    target,
    analysis: null,
    executable: false,
  };
  const freshTarget = structuredClone(target);
  freshTarget.schema.properties.prop_4 = freshTarget.schema.properties.prop_3;
  delete freshTarget.schema.properties.prop_3;
  freshTarget.schema["x-title-template"] = "$prop_1$ / $prop_4$ $$";
  const restarted = {
    ...retained,
    id: "restarted",
    status: "draft" as const,
    source_schema_version: 2,
    reservations: { region: "prop_4" },
    target: freshTarget,
  };
  const submissions: { method: string; path: string; input: Record<string, unknown> }[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    if (url.endsWith("/analyze")) return json({ analysis_id: "new-analysis" });
    if (init.method === "POST") {
      submissions.push({ method: init.method, path: url, input: JSON.parse(String(init.body)) });
      return json(restarted);
    }
    return json(url.endsWith("/change") ? retained : url.endsWith("/restarted") ? restarted : { items: [] });
  });
  const screen = await openEditor();
  expect(screen.editor().actions.history?.kind).toBe("restart");
  await act(() => screen.editor().editTitleTemplate("취소할 제목"));
  await act(() => screen.editor().cancelEditing());
  expect(screen.editor().view.draft.schema["x-title-template"]).toBe(target.schema["x-title-template"]);
  await act(async () => {
    await screen.editor().actions.history?.run?.();
  });
  expect(submissions).toEqual([{
    method: "POST",
    path: expect.stringMatching(/\/entity-types\/kind\/schema-changes$/),
    input: {
      expected_schema_version: 2,
      edits: [{ op: "set_metadata", "x-title-template": "$prop_1$ / $new_region$ $$" }, {
        op: "add_property",
        client_ref: "region",
        field: target.schema.properties.prop_3,
        required: false,
      }],
      migration: { rules: [], overrides: [] },
    },
  }]);
  expect(screen.editor().view.draft.schema["x-title-template"]).toBe("$prop_1$ / $prop_4$ $$");
  expect(screen.editor().view.draft.schema.properties.prop_3).toBeUndefined();
  expect(screen.editor().view.draft.schema.properties.prop_4.title).toBe("지역");
  expect(renderEntityTitle(screen.editor().view.draft.schema, { prop_1: "상점", prop_4: "서울" }, "번호")).toBe(
    "상점 / 서울 $",
  );
});

test("published selected identity stays required, active and present while its label remains editable", async () => {
  vi.stubGlobal("fetch", async () => json({ items: [], next_before: null }));
  const screen = await openEditor();
  const selected = definition.schema["x-identity-property"]!;
  await act(() => screen.editor().removeField(selected));
  await act(() => screen.editor().editFlag(selected, "required", false));
  await act(() => screen.editor().setFieldInactive(selected, true));
  await act(() => screen.editor().editField(selected, { ...definition.schema.properties[selected], type: "integer" }));
  expect(screen.editor().view.draft.schema.properties[selected]).toEqual(definition.schema.properties[selected]);
  expect(screen.editor().view.draft.schema.required).toContain(selected);
  await act(() =>
    screen.editor().editField(selected, { ...definition.schema.properties[selected], title: "상품 번호" })
  );
  expect(screen.editor().view.draft.schema.properties[selected].title).toBe("상품 번호");
});

test("only an explicitly empty current schema can select another required identifier in its schema draft", async () => {
  vi.stubGlobal("fetch", async () => json({ items: [], next_before: null }));
  const empty = { ...structuredClone(definition), identity_change_allowed: true };
  empty.schema.properties.prop_3 = {
    type: "string",
    title: "다른 번호",
    "x-order": 30,
    "x-identifier": {
      allowed_kind_ids: ["00000000-0000-4000-8000-000000000001"],
      default_kind_id: "00000000-0000-4000-8000-000000000001",
    },
  };
  empty.schema.required.push("prop_3");
  const screen = await openEditor(empty);
  await act(() => screen.editor().editIdentityProperty("prop_3"));
  expect(screen.editor().view.draft.schema["x-identity-property"]).toBe("prop_3");
  await act(() => screen.editor().editFlag("prop_2", "required", false));
  expect(screen.editor().view.draft.schema.required).not.toContain("prop_2");
  await act(() => screen.editor().editIdentityProperty("prop_1"));
  expect(screen.editor().view.draft.schema["x-identity-property"]).toBe("prop_3");
});

// @vitest-environment happy-dom
import { act } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import type { Session } from "@supabase/supabase-js";
import { initialEntityDefinition } from "@contracts/entity-type.ts";
import type { EntityValues } from "@contracts/entity.ts";
import { ApiSessionContext } from "../../lib/api-context.tsx";
import { WorkspaceRouteContext } from "../../lib/workspace-route.tsx";
import { AuthContext } from "../auth/auth-context.ts";
import { EntityProperties } from "./EntityProperties.tsx";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(() => root!.unmount());
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

test("entity details keep all title-participating attributes as ordinary key-value fields in configured order", async () => {
  const definition = initialEntityDefinition("고객명");
  definition.schema.properties.prop_3 = { type: "string", title: "지역", "x-order": 5 };
  definition.schema["x-title-template"] = "$prop_1$ - $prop_3$";
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(definition), { status: 200 })));
  const session = { user: { id: "fixture-user" }, access_token: "fixture-token" } as Session;
  const readSession = async () => ({ data: { session } });
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const entity: EntityValues = {
    entity_type_id: "fixture-type",
    current_schema_version: 1,
    title: "초록상점 - 서울",
    properties: { prop_1: "초록상점", prop_2: "00000000-0000-4000-8000-000000000001:고객-1", prop_3: "서울" },

    id: "fixture-entity",
    identity_label: "앱 · 고객-1",
    deleted_at: null,
    type: { id: "fixture-type", label: "고객", icon_id: "box", archived: false },
    schema_version: 1,
    version: 1,
    tag_ids: [],
    created_at: "2026-10-21T00:00:00Z",
    updated_at: "2026-10-21T00:00:00Z",
  };
  await act(async () => {
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
        <WorkspaceRouteContext.Provider value="fixture-workspace">
          <ApiSessionContext.Provider value={readSession}>
            <EntityProperties entity={entity} />
          </ApiSessionContext.Provider>
        </WorkspaceRouteContext.Provider>
      </AuthContext.Provider>,
    );
  });
  expect([...container.querySelectorAll("dt")].map((item) => item.textContent)).toEqual(["지역", "고객명", "식별자 · 자료 식별자"]);
  expect([...container.querySelectorAll("dd")].map((item) => item.textContent)).toEqual(["서울", "초록상점", "고객-1"]);
  expect(container.querySelector("h2,h3")).toBeNull();
});

test("schema read failure preserves a readable identity while ordinary properties await retry", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ code: "unavailable", message: "정의 조회 실패" }), { status: 503 })));
  const session = { user: { id: "fixture-user" }, access_token: "fixture-token" } as Session;
  const entity: EntityValues = {
    id: "00000000-0000-4000-8000-000000000001:00000000-0000-4000-8000-000000000001:00123",
    identity_label: "판매처 · 상품 번호 · 00123", entity_type_id: "fixture-type", current_schema_version: 1,
    title: "상품", properties: { prop_1: "상품" }, deleted_at: null,
    type: { id: "fixture-type", label: "상품", icon_id: "box", archived: false },
    schema_version: 1, version: 1, tag_ids: [], created_at: "2026-10-21T00:00:00Z", updated_at: "2026-10-21T00:00:00Z",
  };
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(
    <AuthContext.Provider value={{ session, loading: false, savePreferences: async () => { throw new Error("unused"); } }}>
      <WorkspaceRouteContext.Provider value="fixture-workspace">
        <ApiSessionContext.Provider value={async () => ({ data: { session } })}>
          <EntityProperties entity={entity} />
        </ApiSessionContext.Provider>
      </WorkspaceRouteContext.Provider>
    </AuthContext.Provider>,
  ));
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("속성 정의를 불러오지 못했습니다");
  expect(container.querySelector("dt")?.textContent).toBe("자료 식별자");
  expect(container.querySelector("dd")?.textContent).toBe(entity.identity_label);
  expect(container.querySelector("button")?.textContent).toBe("속성 정의 다시 조회");
});

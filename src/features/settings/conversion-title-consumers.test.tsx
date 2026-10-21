// @vitest-environment happy-dom
import { act } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import type { Session } from "@supabase/supabase-js";
import { initialEntityDefinition } from "@contracts/entity-type.ts";
import type { EntitySchemaChange } from "@contracts/entity-schema-change.ts";
import { ApiSessionContext } from "../../lib/api-context.tsx";
import { WorkspaceRouteContext } from "../../lib/workspace-route.tsx";
import { AuthContext } from "../auth/auth-context.ts";
import { ConversionEditor } from "./ConversionEditor.tsx";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(() => root!.unmount());
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

test("conversion review identifies before and after values with their respective title templates", async () => {
  const source = initialEntityDefinition("고객명");
  source.schema.properties.prop_2 = { type: "string", title: "지역", "x-order": 20 };
  source.schema["x-title-template"] = "$prop_1$ - $prop_2$";
  const target = structuredClone(source);
  target.schema["x-title-template"] = "[$prop_2$] $prop_1$";
  const plan = {
    id: "change",
    type_id: "kind",
    target,
    diff: [],
    migration: { rules: [], overrides: [] },
    analysis: { id: "analysis", status: "succeeded", total: 1 },
  } as unknown as EntitySchemaChange;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(
        JSON.stringify({
          items: [{
            entity_id: "고객-1",
            before: { prop_1: "초록상점", prop_2: "서울" },
            after: { prop_1: "초록상점", prop_2: "부산" },
            changed: true,
            errors: [],
          }],
          next_after: null,
        }),
        { status: 200 },
      )
    ),
  );
  const session = { user: { id: "fixture-user" }, access_token: "fixture-token" } as Session;
  const readSession = async () => ({ data: { session } });
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
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
            <ConversionEditor
              plan={plan}
              sourceDefinition={source}
              migration={plan.migration}
              onChange={() => {}}
              disabled
            />
          </ApiSessionContext.Provider>
        </WorkspaceRouteContext.Provider>
      </AuthContext.Provider>,
    );
  });
  expect(container.textContent).toContain("초록상점 - 서울 → [부산] 초록상점 · 고객-1");
});

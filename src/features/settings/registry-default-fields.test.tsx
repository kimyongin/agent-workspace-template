// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { expect, test, vi } from "vitest";
import type { Session } from "@supabase/supabase-js";
import { AuthContext } from "../auth/auth-context.ts";
import { WorkspaceCapabilitiesContext } from "../workspaces/workspace-context.tsx";
import { WorkspaceRouteContext } from "../../lib/workspace-route.tsx";
import { ApiSessionContext } from "../../lib/api-context.tsx";
import { IssuerRegistryEditor } from "./IssuerRegistryEditor.tsx";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
test("a refused registry stop preserves its draft and links every affected field of the same type", async () => {
  const type = "11111111-1111-4111-8111-111111111111", id = "22222222-2222-4222-8222-222222222222";
  const session = { user: { id: "actor" }, access_token: "test-token" } as Session;
  vi.stubGlobal(
    "fetch",
    async () =>
      new Response(
        JSON.stringify({
          code: "invalid_input",
          message: "항목의 기본 종류를 변경하세요",
          retryable: false,
          fields: [{ path: `default_fields.${type}.prop_3`, message: "상품 · 고객 번호" }, {
            path: `default_fields.${type}.prop_4`,
            message: "상품 · 주문 번호",
          }],
        }),
        { status: 400 },
      ),
  );
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(() =>
      root.render(
        <AuthContext.Provider value={{ session, loading: false, savePreferences: async () => {} }}>
          <ApiSessionContext.Provider value={async () => ({ data: { session } })}>
            <WorkspaceRouteContext.Provider value="space">
              <WorkspaceCapabilitiesContext.Provider
                value={{
                  workspace: { id: "space", name: "공간", deleted_at: null },
                  grants: [{ target_kind: "settings", target_id: "*", access: "write" }],
                  can_manage: true,
                  membership_version: 1,
                }}
              >
                <MemoryRouter>
                  <IssuerRegistryEditor
                    inline
                    target={{
                      kind: "rule",
                      source: "crm",
                      sourceLabel: "고객 시스템",
                      rule: {
                        id,
                        source: "crm",
                        label: "고객 번호",
                        meaning: "원본 고객 번호",
                        generation: "direct",
                        active: true,
                        version: 1,
                      },
                    }}
                    onClose={() => {}}
                    onSaved={() => {
                      throw Error("refused write cannot save");
                    }}
                  />
                </MemoryRouter>
              </WorkspaceCapabilitiesContext.Provider>
            </WorkspaceRouteContext.Provider>
          </ApiSessionContext.Provider>
        </AuthContext.Provider>,
      )
    );
    await act(() => host.querySelector<HTMLButtonElement>('button[role="checkbox"]')!.click());
    await act(() =>
      host.querySelector<HTMLFormElement>("form")!.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      )
    );
    await act(async () => {
      [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
        button.textContent === "중지하고 저장"
      )!.click();
    });
    const links = [...host.querySelectorAll<HTMLAnchorElement>("a")];
    expect(links).toHaveLength(2);
    expect(links.map((link) => link.getAttribute("href")!.split("?")[1])).toEqual([
      "property=prop_3",
      "property=prop_4",
    ]);
    expect(links.map((link) => link.getAttribute("aria-label"))).toEqual([
      "상품 · 고객 번호 기본 식별자 종류 변경",
      "상품 · 주문 번호 기본 식별자 종류 변경",
    ]);
    expect(host.querySelector('button[role="checkbox"]')!.getAttribute("aria-checked")).toBe("false");
  } finally {
    await act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

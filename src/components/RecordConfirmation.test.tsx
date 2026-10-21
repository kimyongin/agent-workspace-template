// @vitest-environment happy-dom
import { act, useState } from "react";
import { MemoryRouter } from "react-router";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import type { Session } from "@supabase/supabase-js";
import { AuthContext } from "../features/auth/auth-context.ts";
import { WorkspaceRouteContext } from "../lib/workspace-route.tsx";
import { ApiSessionContext } from "../lib/api-context.tsx";
import { SurfaceActionContext, type SurfaceAction } from "./Modal.tsx";
import { type RecordMemo, useRecordConfirmation } from "./RecordConfirmation.tsx";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(() => root!.unmount());
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

for (const pending of [false, true]) for (const edited of [false, true]) test(`pending ID=${pending} preserves ${edited ? "edited" : "server default"} record memo`, async () => {
  const execute = vi.fn<(key: () => string, memo: RecordMemo) => Promise<void>>(async () => {});
  vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(JSON.stringify(url.includes("/records/prepare") ? {
    prepared_input: {}, change_note: "자료를 등록했습니다", change_tag_ids: [], missing_tag_ids: [],
    settings_version: 1, ...(pending ? { pending_entity_id: true } : {}),
  } : { items: [] }), { status: 200 })));
  function Confirmation() {
    useRecordConfirmation({ initial: "save", describe: () => ({
      title: "등록하시겠습니까?", label: "등록하고 저장", defaultNote: "", record: true,
      preparation: () => ({ model: "entity", action: "create", input: {} }), execute,
    }) });
    return null;
  }
  function Host() {
    const [action, setAction] = useState<SurfaceAction | null>(null);
    return <SurfaceActionContext.Provider value={setAction}><Confirmation />{action?.body}{action?.footer}</SurfaceActionContext.Provider>;
  }
  const session = { user: { id: "fixture-user" }, access_token: "fixture-token" } as Session;
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root!.render(
    <AuthContext.Provider value={{ session, loading: false, savePreferences: async () => { throw new Error("unused"); } }}>
      <WorkspaceRouteContext.Provider value="fixture-workspace">
        <ApiSessionContext.Provider value={async () => ({ data: { session } })}><MemoryRouter><Host /></MemoryRouter></ApiSessionContext.Provider>
      </WorkspaceRouteContext.Provider>
    </AuthContext.Provider>,
  ));
  expect(container.textContent?.includes("저장 후 발급되는 자료 번호로 기록 메모가 완성됩니다")).toBe(pending);
  if (edited) await act(async () => {
    const input = container.querySelector("textarea")!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, "직접 입력한 이유");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => [...container.querySelectorAll("button")].find(button => button.textContent === "등록하고 저장")!.click());
  expect(execute).toHaveBeenCalledTimes(1);
  expect(execute.mock.calls[0][1]).toEqual(edited ? { change_note: "직접 입력한 이유", change_tag_ids: [] } : pending ? { change_tag_ids: [] } : { change_note: "자료를 등록했습니다", change_tag_ids: [] });
});

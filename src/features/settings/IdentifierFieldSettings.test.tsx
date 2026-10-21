// @vitest-environment happy-dom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import type { EntityField } from "@contracts/entity-type.ts";
import { IdentifierFieldSettings } from "./IdentifierFieldSettings.tsx";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let cleanup: () => Promise<void>;
afterEach(async () => {
  await cleanup?.();
  document.body.innerHTML = "";
});
const app = "00000000-0000-4000-8000-000000000001",
  first = "11111111-1111-4111-8111-111111111111",
  second = "22222222-2222-4222-8222-222222222222",
  stopped = "33333333-3333-4333-8333-333333333333";
const kinds = [
  {
    id: app,
    source: "app",
    source_label: "앱",
    label: "자동 발급",
    generation: "automatic" as const,
    active: true,
    version: 1,
    source_version: 1,
  },
  ...[[first, "상품 번호"], [second, "주문 번호"], [stopped, "중지 번호"]].map(([id, label]) => ({
    id,
    source: "seller",
    source_label: "판매자",
    label,
    generation: "direct" as const,
    active: id !== stopped,
    version: 1,
    source_version: 1,
  })),
];
async function open(selected = false) {
  let current!: EntityField;
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  function Screen() {
    const [field, setField] = useState<EntityField>({
      type: "string",
      "x-order": 30,
      "x-identifier": { allowed_kind_ids: [app], default_kind_id: app },
    });
    current = field;
    return <IdentifierFieldSettings field={field} kinds={kinds} selected={selected} onChange={setField} />;
  }
  await act(() => root.render(<Screen />));
  cleanup = async () => {
    await act(() => root.unmount());
  };
  return { host, value: () => current };
}
test("one identifier field permits several kinds from the same source and keeps default choice within allowed active kinds", async () => {
  const f = await open();
  const check = (id: string) => f.host.querySelector<HTMLButtonElement>(`button[role=checkbox][value="${id}"]`)!;
  await act(() => check(first).click());
  await act(() => check(second).click());
  const select = f.host.querySelector<HTMLSelectElement>('select[aria-label="기본 식별자 종류"]')!;
  await act(() => {
    select.value = second;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(f.value()["x-identifier"]).toEqual({ allowed_kind_ids: [app, first, second], default_kind_id: second });
  expect(check(stopped).disabled).toBe(true);
  expect(check(second).disabled).toBe(true);
});
test("ordinary fixed defaults serialize complete kind/raw values while selected identities offer no fixed-default editor", async () => {
  const f = await open();
  const mode = f.host.querySelector<HTMLSelectElement>('select[aria-label="식별자 생성 기본값"]')!;
  await act(() => {
    mode.value = "value";
    mode.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const raw = f.host.querySelector<HTMLInputElement>('input[aria-label="식별자 기본 원본 값"]')!;
  await act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(raw, "001A:B");
    raw.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(f.value().default).toBe(`${app}:001A:B`);
  await cleanup();
  const selected = await open(true);
  expect(selected.host.querySelector('select[aria-label="식별자 생성 기본값"]')).toBeNull();
  expect(selected.host.textContent).toContain("자료 식별자");
});
test("invalid raw default drafts stay visible and cannot be reinterpreted as a shorter encoded pair", async () => {
  const f = await open();
  const mode = f.host.querySelector<HTMLSelectElement>('select[aria-label="식별자 생성 기본값"]')!;
  await act(() => {
    mode.value = "value";
    mode.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const value = `${first}:${"x".repeat(190)}`;
  const raw = f.host.querySelector<HTMLInputElement>('input[aria-label="식별자 기본 원본 값"]')!;
  await act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(raw, value);
    raw.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(raw.value).toBe(value);
  expect(f.value().default).toBe("");
  expect(f.host.textContent).toContain("1~200자");
});

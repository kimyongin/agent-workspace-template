// @vitest-environment happy-dom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { initialEntityDefinition } from "@contracts/entity-type.ts";
import { PropertyFields, type PropertyDraft } from "./property-fields.tsx";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const kind = "00000000-0000-4000-8000-000000000001";
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(() => root!.unmount());
  document.body.replaceChildren();
});

function setup(initial: PropertyDraft, locked = false) {
  const definition = initialEntityDefinition("이름");
  definition.schema.properties.prop_3 = {
    type: ["string", "null"], title: "외부 번호", "x-order": 30,
    "x-identifier": { allowed_kind_ids: [kind], default_kind_id: kind },
  };
  const generations: Record<string, string | undefined> = {};
  let latest = initial;
  function Form() {
    const [values, setValues] = useState(initial);
    const [intent, setIntent] = useState<Record<string, string>>({});
    latest = values;
    return <PropertyFields
      definition={{ ...definition, identifier_kinds: [{
        id: kind, source: "app", source_label: "앱", label: "자동 번호", active: true,
        generation: "automatic", version: 1, source_version: 1,
      }] }}
      values={values} errors={{}} identityLocked={locked} generations={intent}
      onChange={setValues}
      onGenerate={(key, value) => {
        generations[key] = value;
        setIntent(current => {
          const next = { ...current };
          if (value) next[key] = value; else delete next[key];
          return next;
        });
      }}
    />;
  }
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  return { container, render: () => act(async () => root!.render(<Form />)), generations, values: () => latest };
}

test("editing keeps the selected identity static while another identifier remains editable", async () => {
  const form = setup({ prop_1: "상품", prop_2: `${kind}:001`, prop_3: `${kind}:001` }, true);
  await form.render();
  const labels = [...form.container.querySelectorAll("label")];
  expect(labels.some(label => label.textContent?.includes("식별자"))).toBe(false);
  expect(form.container.textContent).toContain("자료 식별자");
  expect([...form.container.querySelectorAll("input")].map(input => input.value)).toContain("001");
  expect([...form.container.querySelectorAll("input")].filter(input => input.value === "001")).toHaveLength(1);
});

test("an omitted optional identifier issues nothing until the user explicitly selects its automatic rule", async () => {
  const form = setup({ prop_1: "상품", prop_2: `${kind}:001` }, true);
  await form.render();
  expect(form.generations).toEqual({});
  expect(form.values()).not.toHaveProperty("prop_3");
  const select = form.container.querySelector<HTMLSelectElement>('select[aria-label="외부 번호 종류"]')!;
  expect(select.value).toBe("unset");
  expect(form.container.querySelectorAll("input:disabled")).toHaveLength(0);
  expect([...form.container.querySelectorAll("button")].filter(button => button.textContent === "새 번호 발급")).toHaveLength(0);
  await act(async () => { select.value = kind; select.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(form.generations.prop_3).toBe(kind);
  expect(form.values()).not.toHaveProperty("prop_3");
  expect(form.container.textContent).toContain("저장 시 자동 발급");
  await act(async () => { select.value = "unset"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(form.generations.prop_3).toBeUndefined();
  expect(form.values()).not.toHaveProperty("prop_3");
});

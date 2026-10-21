// @vitest-environment happy-dom
import { afterEach, expect, test } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { initialEntityDefinition } from "@contracts/entity-type.ts";
import { SchemaTitleTemplateSetting } from "./SchemaTitleTemplateSetting.tsx";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(() => root!.unmount());
  document.body.replaceChildren();
});

test("title editor shows renamed property labels while retaining the composed example", async () => {
  const draft = initialEntityDefinition("고객명");
  draft.schema.properties.prop_2 = { type: "string", title: "지역", default: "서울", "x-order": 20 };
  draft.schema.properties.prop_1.default = "초록상점";
  draft.schema["x-title-template"] = "$prop_1$ - $prop_2$";
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const changes: string[] = [];
  const render = () =>
    root!.render(
      <SchemaTitleTemplateSetting
        draft={draft}
        saved={draft}
        disabled={false}
        readOnly={true}
        onChange={(value) => changes.push(value)}
      />,
    );
  await act(render);
  const input = container.querySelector<HTMLElement>('[role="textbox"][aria-label="제목 템플릿"]')!;
  expect(input.textContent).toBe("고객명 - 지역");
  expect(container.textContent).toContain("초록상점 - 서울");
  draft.schema.properties.prop_1.title = "상점명";
  await act(render);
  expect(input.textContent).toBe("상점명 - 지역");
  expect(container.textContent).toContain("초록상점 - 서울");
  expect(changes).toEqual([]);
});

test("title settings identify invalid references beside the template", async () => {
  const draft = initialEntityDefinition("고객명");
  draft.schema["x-title-template"] = "$prop_999$";
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(() =>
    root!.render(
      <SchemaTitleTemplateSetting draft={draft} saved={draft} disabled={false} readOnly={true} onChange={() => {}} />,
    )
  );
  const input = container.querySelector('[role="textbox"][aria-label="제목 템플릿"]')!;
  expect(input.getAttribute("aria-invalid")).toBe("true");
  expect(container.textContent).toContain("사용 중인 속성을 선택하세요: prop_999");
  expect(container.textContent).not.toContain("예시 제목");
});

test("literal editing keeps canonical variables in the value returned by the title control", async () => {
  const draft = initialEntityDefinition("고객명");
  draft.schema["x-title-template"] = "$prop_1$";
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const changes: string[] = [];
  await act(() =>
    root!.render(
      <SchemaTitleTemplateSetting
        draft={draft}
        saved={draft}
        disabled={false}
        readOnly={false}
        onChange={(value) => changes.push(value)}
      />,
    )
  );
  const input = container.querySelector<HTMLElement>('[role="textbox"][aria-label="제목 템플릿"]')!;
  await act(() => {
    input.append(document.createTextNode(" - 상담"));
    input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: " - 상담" }));
  });
  expect(changes).toEqual(["$prop_1$ - 상담"]);
});

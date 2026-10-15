import { expect, it } from "vitest";
import { MemoryRouter } from "react-router";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingsMenu } from "./SettingsMenu.tsx";

it("업무 화면에는 설정 범주 메뉴를 반복하지 않는다", () => {
  const html = renderToStaticMarkup(
    <MemoryRouter initialEntries={["/tasks"]}>
      <SettingsMenu />
    </MemoryRouter>,
  );
  expect(html).not.toContain("설정 메뉴");
});

it("설정 화면에서는 이름 있는 메뉴 버튼만 먼저 보여준다", () => {
  const html = renderToStaticMarkup(
    <MemoryRouter initialEntries={["/settings/records"]}>
      <SettingsMenu />
    </MemoryRouter>,
  );
  expect(html).toContain('aria-label="설정 메뉴"');
  expect(html).toContain('aria-expanded="false"');
  expect(html).not.toContain('href="/settings/materials"');
});

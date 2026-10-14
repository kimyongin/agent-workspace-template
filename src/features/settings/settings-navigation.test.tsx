import { expect, it } from "vitest";
import { MemoryRouter } from "react-router";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingsNavigation } from "./SettingsNavigation.tsx";
it("설정 메뉴에서 기본·자료·태그·기록과 발급처로 이동한다", () => {
  const html = renderToStaticMarkup(<MemoryRouter initialEntries={["/settings/records"]}><SettingsNavigation /></MemoryRouter>);
  for (const path of ["/settings", "/settings/materials", "/settings/tags", "/settings/records", "/settings/issuers"]) expect(html).toContain(`href="${path}"`);
  expect(html).toMatch(/aria-current="page"[^>]*href="\/settings\/records"/);
});

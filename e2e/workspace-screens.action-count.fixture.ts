import { expect, test, type Locator } from "@playwright/test";
import { baseWorkspace, detailDialog } from "./ui-actions.ts";
import { fixtures } from "./support/workspace-screens.ts";
import { fixtureType } from "./support/workspace-data.ts";

// Counts start on the space list. Navigation, menu disclosure and confirmation
// are user actions too; automatic route changes and reads are not.
for (const width of [390, 1440]) {
  for (const scenario of [
    { kind: "entity", menu: fixtureType.label, title: "자료", desktop: 8, mobile: 9 },
    { kind: "task", menu: null, title: "할 일", desktop: 7, mobile: 7 },
    { kind: "record", menu: "기록", title: "내용", desktop: 7, mobile: 8 },
  ] as const) {
    test(`공간 목록부터 ${scenario.kind} 태그 연결 ${width}: 이동·선택·실행 전체 액션`, async ({ page }, info) => {
      const state = await fixtures(page);
      await page.unroute("http://127.0.0.1:55580/**");
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/workspaces");
      const actions: string[] = [];
      const click = async (label: string, control: Locator) => {
        await control.click();
        actions.push(label);
      };

      await click("공간 열기", page.getByRole("link", { name: "열기", exact: true }));
      await expect(page).toHaveURL(/\/tasks$/);
      if (scenario.menu) {
        const openMenu = page.getByRole("button", { name: "주 메뉴 열기", exact: true });
        if (await openMenu.isVisible()) await click("주 메뉴 열기", openMenu);
        await click(`${scenario.menu} 메뉴 링크`, page.getByRole("navigation", { name: "주 메뉴", exact: true })
          .getByRole("link", { name: scenario.menu, exact: true }));
      }
      await click("대상 제목 링크", baseWorkspace(page).getByRole("link", { name: scenario.title, exact: true }));
      const region = detailDialog(page).getByRole("region", { name: "태그 연결", exact: true });
      await click("태그 연결", region.getByRole("button", { name: "태그 연결", exact: true }));
      const picker = page.getByRole("dialog", { name: "태그 선택", exact: true });
      await expect(picker).toBeVisible();
      await click("태그 후보 선택", picker.getByRole("option", { name: "같은 이름", exact: true }));
      await click("선택 완료", picker.getByRole("button", { name: "선택 완료", exact: true }));
      expect(state.writes).toHaveLength(0);
      await click("연결 적용", region.getByRole("button", { name: "연결 적용", exact: true }));
      if (scenario.kind !== "record") {
        expect(state.writes).toHaveLength(0);
        await click("변경 메모 확인·실행", page.getByRole("dialog", { name: "태그 연결을 적용하시겠습니까?", exact: true })
          .getByRole("button", { name: "연결하고 저장", exact: true }));
      }
      await expect(region).toContainText("태그 연결을 저장했습니다.");
      expect(state.writes).toHaveLength(1);
      expect(state.writes[0].body).toMatchObject({ target_kind: scenario.kind });
      expect(state.errors).toEqual([]);
      expect(actions).toHaveLength(width === 390 ? scenario.mobile : scenario.desktop);
      await info.attach("space-to-tag-actions", {
        body: JSON.stringify({ start: "내 공간 목록", width, kind: scenario.kind, actions, count: actions.length }, null, 2),
        contentType: "application/json",
      });
    });
  }
}

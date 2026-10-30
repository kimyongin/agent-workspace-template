import { expect, type Page, test } from "@playwright/test";
import type { WorkspaceInvitation } from "../supabase/functions/_shared/contracts/workspace.ts";
import { a, fixture } from "./support/workspace-control-fixture.ts";
import { openMainNavigation } from "./ui-actions.ts";

const invitationId = "00000000-0000-4000-8000-000000000990";
async function invitations(page: Page) {
  const api = await fixture(page);
  const writes: string[] = [];
  page.on("request", request => {
    if (new URL(request.url()).pathname.startsWith("/api/") && request.method() !== "GET") writes.push(`${request.method()} ${new URL(request.url()).pathname}`);
  });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      writeText: async (value: string) => { (window as unknown as { copied: string }).copied = value; },
    } });
  });
  await page.route("**/api/workspaces/*/members", route => route.fulfill({ json: { items: [] } }));
  await page.route("**/api/workspaces/*/grant-targets", route => route.fulfill({ json: { items: [] } }));
  const state: { items: WorkspaceInvitation[] } = { items: [{
    id: invitationId, workspace_id: a, version: 1, email: "guest@example.test",
    grants: [], expires_at: "2099-01-01T00:00:00Z", revoked_at: null,
    accepted_at: null, accepted_by: null, delivery: { status: "sent" },
  }] };
  await page.route("**/api/workspaces/*/invitations", route => {
    if (route.request().method() !== "GET") return route.fallback();
    return route.fulfill({ json: state });
  });
  return { api, writes, state };
}

test("administrator copies the existing invitation from its row without a business write", async ({ page }, info) => {
  const { api, writes } = await invitations(page);
  await page.goto("/workspaces");
  await page.getByRole("row").filter({ hasText: "공간 A" }).getByRole("link", { name: "열기", exact: true }).click();
  await openMainNavigation(page);
  await page.getByRole("link", { name: "이 공간 관리", exact: true }).click();
  const row = page.getByRole("row").filter({ hasText: "guest@example.test" });
  await expect(row).toBeVisible();
  await page.screenshot({ path: info.outputPath("invitation-before-copy.png"), fullPage: true });
  await row.getByRole("button", { name: "초대 링크 복사", exact: true }).click({ timeout: 5000 });
  await expect(row.getByRole("status")).toHaveText("초대 링크를 복사했습니다.");
  await expect(row.getByRole("textbox", { name: "초대 수락 링크", exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { copied: string }).copied)).toBe(
    "http://127.0.0.1:55612/invitations/00000000-0000-4000-8000-000000000990",
  );
  expect(api.writes).toEqual([]);
  expect(writes).toEqual([]);
  await page.screenshot({ path: info.outputPath("invitation-after-copy.png"), fullPage: true });
  await info.attach("action-count", { body: JSON.stringify({ start: "내 공간", end: "기존 초대 링크 복사 완료", actions: info.project.name === "mobile" ? 4 : 3, writes }), contentType: "application/json" });
});

test("clipboard denial offers the same invitation link for direct keyboard selection", async ({ page }, info) => {
  const { writes } = await invitations(page);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`/w/${a}/manage`);
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      writeText: async () => { throw new DOMException("Denied", "NotAllowedError"); },
    } });
  });
  const row = page.getByRole("row").filter({ hasText: "guest@example.test" });
  const copy = row.getByRole("button", { name: "초대 링크 복사", exact: true });
  await copy.focus();
  await page.keyboard.press("Enter");
  await expect(row.getByRole("status")).toHaveText("복사하지 못했습니다. 아래 링크를 직접 선택해 복사하세요.");
  const link = row.getByRole("textbox", { name: "초대 수락 링크", exact: true });
  await expect(link).toHaveValue("http://127.0.0.1:55612/invitations/00000000-0000-4000-8000-000000000990");
  await expect(link).toHaveAttribute("readonly", "");
  await expect(copy).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(link).toBeFocused();
  await page.keyboard.press("ControlOrMeta+A");
  expect(await link.evaluate((input: HTMLInputElement) => input.value.slice(input.selectionStart!, input.selectionEnd!))).toBe("http://127.0.0.1:55612/invitations/00000000-0000-4000-8000-000000000990");
  expect(writes).toEqual([]);
  expect(errors).toEqual([]);
  await page.screenshot({ path: info.outputPath("invitation-clipboard-denied.png"), fullPage: true });
});

test("unsupported clipboard keeps the link selectable without claiming a copy", async ({ page }, info) => {
  const { writes } = await invitations(page);
  await page.goto(`/w/${a}/manage`);
  await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined }));
  const row = page.getByRole("row").filter({ hasText: "guest@example.test" });
  await row.getByRole("button", { name: "초대 링크 복사", exact: true }).click();
  await expect(row.getByRole("status")).toHaveText("이 브라우저는 링크 복사를 지원하지 않습니다. 아래 링크를 직접 선택해 복사하세요.");
  const link = row.getByRole("textbox", { name: "초대 수락 링크", exact: true });
  await expect(link).toHaveValue("http://127.0.0.1:55612/invitations/00000000-0000-4000-8000-000000000990");
  expect(writes).toEqual([]);
  await page.screenshot({ path: info.outputPath("invitation-clipboard-unavailable.png"), fullPage: true });
});

test("only active invitations offer copy and an open page removes expired link access", async ({ page }, info) => {
  const { state, writes } = await invitations(page);
  const active = state.items[0];
  const start = new Date();
  active.expires_at = new Date(start.getTime() + 60_000).toISOString();
  state.items.push(
    { ...active, id: "00000000-0000-4000-8000-000000000991", email: "accepted@example.test", accepted_at: "2026-10-30T09:00:00Z" },
    { ...active, id: "00000000-0000-4000-8000-000000000992", email: "revoked@example.test", revoked_at: "2026-10-30T09:00:00Z" },
    { ...active, id: "00000000-0000-4000-8000-000000000993", email: "expired@example.test", expires_at: new Date(start.getTime() - 60_000).toISOString() },
  );
  await page.goto(`/w/${a}/tasks`);
  await expect(page.getByText("space A task", { exact: true }).first()).toBeVisible();
  await page.clock.install({ time: start });
  await openMainNavigation(page);
  await page.getByRole("link", { name: "이 공간 관리", exact: true }).click();
  await expect(page.getByRole("button", { name: "초대 링크 복사", exact: true })).toHaveCount(1);
  const row = page.getByRole("row").filter({ hasText: "guest@example.test" });
  await row.getByRole("button", { name: "초대 링크 복사", exact: true }).click();
  await expect(row.getByRole("status")).toHaveText("초대 링크를 복사했습니다.");
  await page.clock.fastForward(60_001);
  await expect(row.getByText("만료됨", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "초대 링크 복사", exact: true })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "초대 수락 링크", exact: true })).toHaveCount(0);
  expect(writes).toEqual([]);
  await page.screenshot({ path: info.outputPath("invitation-inactive-states.png"), fullPage: true });
});

test("newly created invitation shares clipboard feedback and clears link controls when management permission changes", async ({ page }, info) => {
  const { state } = await invitations(page);
  const invitation = state.items[0];
  invitation.delivery = { status: "pending" };
  state.items = [];
  await page.route(`**/api/workspaces/${a}/invitations`, route => {
    if (route.request().method() !== "POST") return route.fallback();
    state.items = [invitation];
    return route.fulfill({ status: 201, json: { invitation, acceptance_path: `/invitations/${invitationId}`, delivery: { status: "pending" } } });
  });
  await page.goto(`/w/${a}/manage`);
  await page.getByRole("button", { name: "이메일로 초대", exact: true }).click();
  await page.getByRole("textbox", { name: "초대할 이메일", exact: true }).fill("guest@example.test");
  await page.getByRole("button", { name: "초대 만들기", exact: true }).click();
  const delivery = page.getByRole("alert").filter({ hasText: "초대를 만들었습니다." });
  await expect(delivery).toBeVisible();
  const acceptanceUrl = "http://127.0.0.1:55612/invitations/00000000-0000-4000-8000-000000000990";
  const acceptance = delivery.getByRole("link", { name: acceptanceUrl, exact: true });
  await expect(acceptance).toBeVisible();
  await expect(acceptance).toHaveAttribute("href", acceptanceUrl);
  await delivery.getByRole("button", { name: "초대 링크 복사", exact: true }).click();
  await expect(delivery.getByRole("status")).toHaveText("초대 링크를 복사했습니다.");
  await expect(acceptance).toHaveAttribute("href", acceptanceUrl);
  await expect(delivery.getByRole("textbox", { name: "초대 수락 링크", exact: true })).toHaveCount(0);
  await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined }));
  await delivery.getByRole("button", { name: "초대 링크 복사", exact: true }).click();
  await expect(delivery.getByRole("status")).toHaveText("이 브라우저는 링크 복사를 지원하지 않습니다. 아래 링크를 직접 선택해 복사하세요.");
  await expect(acceptance).toHaveAttribute("href", acceptanceUrl);
  await expect(delivery.getByRole("textbox", { name: "초대 수락 링크", exact: true })).toHaveValue(acceptanceUrl);
  await page.screenshot({ path: info.outputPath("invitation-created-anchor-fallback.png"), fullPage: true });
  await page.route(`**/api/workspaces/${a}`, route => route.fulfill({ json: {
    workspace: { id: a, name: "공간 A", deleted_at: null }, membership_version: 2,
    can_manage: false, grants: [],
  } }));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByText("공간 관리 권한이 없습니다", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "초대 링크 복사", exact: true })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "초대 수락 링크", exact: true })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("invitation-management-permission-lost.png"), fullPage: true });
});

test("a delayed clipboard result cannot display an old-space link in the next space", async ({ page }) => {
  const { writes } = await invitations(page);
  await page.goto(`/w/${a}/manage`);
  await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
    writeText: () => new Promise<void>(resolve => { (window as unknown as { finishCopy: () => void }).finishCopy = resolve; }),
  } }));
  await page.getByRole("row").filter({ hasText: "guest@example.test" }).getByRole("button", { name: "초대 링크 복사", exact: true }).click();
  await openMainNavigation(page);
  await page.getByRole("button", { name: "공간 선택", exact: true }).click();
  await page.getByRole("menuitem", { name: "공간 B", exact: true }).click();
  await expect(page.getByText("space B task", { exact: true }).first()).toBeVisible();
  await page.evaluate(() => (window as unknown as { finishCopy: () => void }).finishCopy());
  await expect(page.getByText("초대 링크를 복사했습니다.", { exact: true })).toHaveCount(0);
  await openMainNavigation(page);
  await page.getByRole("link", { name: "이 공간 관리", exact: true }).click();
  await expect(page.getByRole("row").filter({ hasText: "guest@example.test" })).toBeVisible();
  await expect(page.getByRole("button", { name: "초대 링크 복사", exact: true })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "초대 수락 링크", exact: true })).toHaveCount(0);
  expect(writes).toEqual([]);
});

test("invitation copy and selectable fallback retain touch targets at narrow widths and 200 percent text", async ({ page }, info) => {
  await invitations(page);
  await page.goto(`/w/${a}/manage`);
  await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined }));
  const row = page.getByRole("row").filter({ hasText: "guest@example.test" });
  const copy = row.getByRole("button", { name: "초대 링크 복사", exact: true });
  await copy.click();
  for (const width of info.project.name === "desktop" ? [320, 360, 390, 639, 640, 768, 1024, 1440] : [393]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(copy).toBeVisible();
    const bounds = await copy.boundingBox();
    expect(bounds!.height).toBeGreaterThanOrEqual(44);
    expect(bounds!.width).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`invitation-fallback-${width}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  await expect(copy).toBeVisible();
  await expect(row.getByRole("textbox", { name: "초대 수락 링크", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await copy.scrollIntoViewIfNeeded();
  await expect(copy).toBeInViewport();
  await row.getByRole("textbox", { name: "초대 수락 링크", exact: true }).scrollIntoViewIfNeeded();
  await expect(row.getByRole("textbox", { name: "초대 수락 링크", exact: true })).toBeInViewport();
  await page.screenshot({ path: info.outputPath("invitation-fallback-200-percent.png"), fullPage: true });
});

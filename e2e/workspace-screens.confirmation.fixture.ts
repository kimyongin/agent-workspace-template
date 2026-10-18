import { fixtureWorkspaceId } from "./support/workspace-scope.ts";
import { executionDialog, openDialogs } from "./ui-actions.ts";
import { chooseTag } from "./ui-actions.ts";
import { entityKey } from "./support/workspace-data.ts";
import { fillChangeMemo, openListDetail } from "./ui-actions.ts";
import { saveOnce } from "./ui-actions.ts";
import { expect, test } from "@playwright/test";
import { id, record, task } from "./support/workspace-data.ts";
import { fillText, fixtures, form, go } from "./support/workspace-screens.ts";

for (const uncertain of [false, true]) {
  test(`#181 반복 중단: 취소·재진입 메모/태그${uncertain ? "·같은 요청 재시도" : ""}`, async ({ page }) => {
    const state = await fixtures(page), attempts: unknown[] = [];
    Object.assign(state.rows.tasks[0], {
      kind: "recurring",
      status: "active",
      timezone: "Asia/Seoul",
      recurrence: { freq: "daily", starts_on: "2026-10-04" },
    });
    await page.route(
      "**/api/tasks/*/occurrences?**",
      (route) => route.fulfill({ json: { today: "2026-10-04", items: [] } }),
    );
    await page.route("**/api/tasks/*/stop", (route) => {
      attempts.push(route.request().postDataJSON());
      return route.abort("connectionreset");
    });
    await go(page, `/tasks/${id(2)}`);
    await form(page).getByRole("button", { name: "중단", exact: true }).click();
    await form(page).getByLabel("기록 메모", { exact: true }).fill("다음 주부터 계획 변경");
    await chooseTag(page, form(page), "같은 이름");
    if (uncertain) {
      await form(page).getByRole("button", { name: "중단하고 저장" }).click();
      await expect(form(page).getByRole("button", { name: "같은 내용 다시 시도" })).toBeVisible();
    }
    await form(page).getByRole("button", { name: "취소", exact: true }).click();
    await form(page).getByRole("button", { name: "중단", exact: true }).click();
    await expect(form(page).getByLabel("기록 메모", { exact: true })).toHaveValue("다음 주부터 계획 변경");
    await expect(form(page).getByRole("button", { name: "같은 이름 선택 해제", exact: true })).toHaveCount(1);
    if (uncertain) {
      await expect(form(page).getByLabel("기록 메모", { exact: true })).toBeDisabled();
      await form(page).getByRole("button", { name: "같은 내용 다시 시도" }).click();
      await expect.poll(() => attempts.length).toBe(2);
      expect(attempts[1]).toEqual(attempts[0]);
    } else expect(attempts).toHaveLength(0);
    expect(state.errors).toEqual([]);
  });
}

test("#181 수행 결과: 메모 없는 삭제 취소가 본문 저장을 막지 않는다", async ({ page }) => {
  const state = await fixtures(page);
  await go(page, `/records/${id(3)}?edit=1&edit_from=view`);
  await form(page).getByRole("button", { name: "삭제", exact: true }).click();
  await expect(form(page).getByLabel("기록 메모", { exact: true })).toHaveCount(0);
  await form(page).getByRole("button", { name: "취소", exact: true }).click();
  await form(page).getByLabel("본문", { exact: false }).fill("유효한 본문");
  await saveOnce(page, form(page));
  await expect.poll(() => state.writes.length).toBe(1);
  expect(state.writes[0].body.body).toBe("유효한 본문");
});

for (const [kind, n, label] of [["entities", 1, "제목"], ["tasks", 2, "제목"]] as const) {
  test(`#181 ${kind}: 편집 위 작은 확인창·취소 초안 보존·기록 태그`, async ({ page }, info) => {
    const state = await fixtures(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await go(page, `/${kind}/${kind === "entities" ? encodeURIComponent(entityKey(n)) : id(n)}?edit=1&edit_from=view`);
    await form(page).getByRole("textbox", { name: `${label} (필수)`, exact: true }).fill("변경 초안");
    await expect(form(page).getByLabel("기록 메모")).toHaveCount(0);
    await form(page).getByRole("button", { name: kind === "tasks" ? "저장" : "저장", exact: true }).click();
    await expect(form(page).getByLabel("기록 메모")).toHaveValue("변경 초안 수정");
    await expect(form(page).locator("dl > div").filter({ has: page.locator("dt").filter({ hasText: /^대상$/ }) }).locator("dd")).toHaveText("변경 초안");
    await expect(form(page).locator("dl > div").filter({ has: page.locator("dt").filter({ hasText: /^작업$/ }) }).locator("dd")).toHaveText("수정");
    await expect(openDialogs(page)).toHaveCount(2);
    expect(state.writes).toHaveLength(0);
    const box = (await form(page).boundingBox())!;
    expect(box.height).toBeLessThan(844 - 32);
    expect(box.y).toBeGreaterThan(0);
    await form(page).getByLabel("기록 메모").fill("금요일 일정에 맞춰 수정함");
    await chooseTag(page, form(page).getByRole("group", { name: "기록 태그", exact: true }), "같은 이름");
    await page.screenshot({ path: info.outputPath(`confirmation-${kind}.png`) });
    await form(page).getByRole("button", { name: "취소", exact: true }).click();
    await expect(form(page).getByRole("textbox", { name: `${label} (필수)`, exact: true })).toHaveValue("변경 초안");
    await expect(form(page).getByRole("button", { name: "저장", exact: true })).toBeFocused();
    await form(page).getByRole("button", { name: "저장", exact: true }).click();
    await expect(form(page).getByLabel("기록 메모")).toHaveValue("금요일 일정에 맞춰 수정함");
    await form(page).getByRole("button", { name: "수정하고 저장", exact: true }).click();
    await expect.poll(() => state.writes.length).toBe(1);
    expect(state.writes[0].body.change_note).toBe("금요일 일정에 맞춰 수정함");
    expect(state.writes[0].body.change_tag_ids).toEqual([id(11)]);
    expect(state.writes[0].body.tag_ids ?? []).toEqual([]);
    expect(state.errors).toEqual([]);
  });
}

test("#181 응답 유실은 확인 입력을 고정하고 같은 ID/version·메모·태그로 재시도", async ({ page }) => {
  const state = await fixtures(page, { failWrite: "unknown" });
  await go(page, `/entities/${encodeURIComponent(entityKey(1))}?edit=1&edit_from=view`);
  await form(page).getByLabel("제목", { exact: false }).fill("수정");
  await form(page).getByRole("button", { name: "저장", exact: true }).click();
  await form(page).getByLabel("기록 메모").fill("동일 요청 메모");
  await form(page).getByRole("button", { name: "수정하고 저장", exact: true }).click();
  await expect(form(page).getByRole("button", { name: "같은 내용 다시 시도", exact: true })).toBeVisible();
  await expect(form(page).getByLabel("기록 메모")).toBeDisabled();
  await form(page).getByRole("button", { name: "같은 내용 다시 시도", exact: true }).click();
  await expect.poll(() => state.writes.length).toBe(2);
  expect(state.writes[1]).toEqual(state.writes[0]);
  expect(state.errors).toEqual([]);
});

test("#181 수행 결과는 바로 저장하고 삭제 확인에 새 변경 메모를 만들지 않는다", async ({ page }) => {
  const state = await fixtures(page);
  await go(page, `/records/${id(3)}?edit=1&edit_from=view`);
  await form(page).getByLabel("본문", { exact: false }).fill("직접 기록 정정");
  await form(page).getByRole("button", { name: "저장", exact: true }).click();
  await expect.poll(() => state.writes.length).toBe(1);
  expect(state.writes[0].body.change_note).toBeUndefined();
  await form(page).getByRole("button", { name: "편집", exact: true }).click();
  await form(page).getByRole("button", { name: "삭제", exact: true }).click();
  await expect(form(page).getByLabel("기록 메모")).toHaveCount(0);
  await expect(form(page).getByRole("group", { name: "기록 태그", exact: true })).toHaveCount(0);
  await expect(openDialogs(page)).toHaveCount(2);
  await form(page).getByRole("button", { name: "삭제하고 기록", exact: true }).click();
  await expect.poll(() => state.writes.length).toBe(2);
  expect(state.writes[1].params.has("change_note")).toBe(false);
  expect(state.errors).toEqual([]);
});

test("반복 중단·재개 메모·결과 생성은 같은 surface", async ({ page }) => {
  const state = await fixtures(page);
  Object.assign(state.rows.tasks[0], {
    kind: "recurring",
    status: "active",
    timezone: "Asia/Seoul",
    recurrence: { freq: "daily", starts_on: "2026-10-04" },
  });
  await page.route(
    "**/api/tasks/*/occurrences?**",
    (route) => route.fulfill({ json: { today: "2026-10-04", items: [] } }),
  );
  for (const [action, status, label] of [["stop", "stopped", "중단"], ["resume", "active", "재개"]]) {
    await page.route("**/api/tasks/*/" + action, (route) => {
      const body = route.request().postDataJSON();
      Object.assign(state.rows.tasks[0], { status, version: state.rows.tasks[0].version + 1 });
      state.writes.push({
        workspaceId: fixtureWorkspaceId,
        method: "POST",
        path: new URL(route.request().url()).pathname,
        body,
        params: new URLSearchParams(),
      });
      return route.fulfill({ json: state.rows.tasks[0] });
    });
    await go(page, `/tasks/${id(2)}`);
    await form(page).getByRole("button", { name: label, exact: true }).click();
    await expect(form(page)).toHaveCount(1);
    await expect(form(page).getByRole("button", { name: label + "하고 저장", exact: true })).toBeVisible();
    await fillChangeMemo(page, form(page), label + " 이유");
    await saveOnce(page, form(page), label);
    await expect(form(page).getByRole("button", { name: label === "중단" ? "재개" : "중단", exact: true }))
      .toBeVisible();
    expect(state.writes.at(-1)?.body.change_note).toBe(label + " 이유");
  }
  Object.assign(state.rows.tasks[0], task());
  await go(page, `/tasks/${id(2)}`);
  await page.route("**/api/tasks/*/complete", (route) => {
    const result = { ...record(40), ...route.request().postDataJSON(), task_id: id(2), record_kind: "result" };
    state.rows.records.push(result);
    Object.assign(state.rows.tasks[0], {
      status: "done",
      version: state.rows.tasks[0].version + 1,
      result_record: { id: result.id, body: result.body },
    });
    return route.fulfill({ json: state.rows.tasks[0] });
  });
  await form(page).getByRole("button", { name: "완료하고 기록", exact: true }).click();
  await expect(form(page).getByRole("button", { name: "완료하고 기록 저장", exact: true })).toBeVisible();
  await fillText(page, "수행 결과");
  await form(page).getByRole("button", { name: "완료하고 기록 저장", exact: true }).click();
  await expect(form(page).getByRole("button", { name: "수행 결과", exact: true })).toBeVisible();
  expect(state.rows.records.at(-1)?.record_kind).toBe("result");
  expect(state.errors).toEqual([]);
});

test("할 일 보기에서 완료, 편집 초안은 닫기 확인으로 보호", async ({ page }) => {
  const state = await fixtures(page);
  await go(page, "/tasks");
  await openListDetail(page, "할 일");
  await form(page).getByRole("button", { name: "완료하고 기록", exact: true }).click();
  await expect(form(page).getByRole("button", { name: "완료하고 기록 저장", exact: true })).toBeVisible();
  await form(page).getByRole("button", { name: "취소", exact: true }).click();
  await expect(page).not.toHaveURL(/action=/);
  await form(page).getByRole("button", { name: "편집", exact: true }).click();
  await form(page).getByLabel("본문").fill("보존할 초안");
  await expect(form(page).getByRole("button", { name: "완료하고 기록", exact: true })).toHaveCount(0);
  await form(page).getByRole("button", { name: "닫기", exact: true }).click();
  const discard = page.getByRole("alertdialog", { name: "변경을 버릴까요?", exact: true });
  await discard.getByRole("button", { name: "취소", exact: true }).click();
  await expect(form(page).getByLabel("본문")).toHaveValue("보존할 초안");
  await form(page).getByRole("button", { name: "닫기", exact: true }).click();
  await discard.getByRole("button", { name: "변경 버리기", exact: true }).click();
  await expect(form(page)).toHaveCount(0);
  await expect(page.locator(`#activity-tasks-${id(2)}`)).toBeFocused();
  expect(state.writes).toHaveLength(0);
  expect(state.errors).toEqual([]);
});

for (const [kind, n] of [["entities", 1], ["tasks", 2], ["records", 3]] as const) {
  test(`${kind}: 두 단계 삭제·취소는 요청 없이 같은 surface`, async ({ page }) => {
    const state = await fixtures(page);
    await go(page, `/${kind}/${kind === "entities" ? encodeURIComponent(entityKey(n)) : id(n)}?edit=1`);
    const before = state.writes.length;
    await form(page).getByRole("button", { name: "삭제", exact: true }).click();
    const confirm = executionDialog(page);
    await expect(confirm.getByRole("button", { name: "삭제하고 기록", exact: true })).toBeVisible();
    await expect(openDialogs(page)).toHaveCount(2);
    expect(state.writes).toHaveLength(before);
    await expect(form(page).getByRole("button", { name: "저장", exact: true })).toHaveCount(0);
    await confirm.getByRole("button", { name: "취소", exact: true }).click();
    await expect(confirm).toHaveCount(0);
    await expect(form(page).getByRole("button", { name: "삭제", exact: true })).toBeFocused();
    expect(state.writes).toHaveLength(before);
    await form(page).getByRole("button", { name: "삭제", exact: true }).click();
    await form(page).getByRole("button", { name: "삭제하고 기록", exact: true }).click();
    await expect.poll(() => new URL(page.url()).pathname).toBe(`/${kind}`);
    expect(state.writes).toHaveLength(before + 1);
    expect(state.errors).toEqual([]);
  });
}

test("#229 할 일의 업무 단계가 직접 편집보다 우선하고 취소 후 편집으로 복귀", async ({ page }) => {
  const state = await fixtures(page);
  await go(page, `/tasks/${id(2)}?edit=1&action=complete&tag_id=${id(9)}`);
  await expect(form(page)).toHaveAccessibleName("할 일 완료");
  await expect(form(page).getByRole("textbox", { name: "제목 (필수)", exact: true })).toHaveCount(0);
  await form(page).getByRole("button", { name: "취소", exact: true }).click();
  await expect(form(page).getByRole("textbox", { name: "제목 (필수)", exact: true })).toBeVisible();
  await expect(page).not.toHaveURL(/[?&]action=/);
  await form(page).getByRole("button", { name: "취소", exact: true }).click();
  await expect(form(page).getByRole("button", { name: "편집", exact: true })).toBeVisible();
  const url = new URL(page.url());
  expect(url.searchParams.get("tag_id")).toBe(id(9));
  expect(url.searchParams.has("edit")).toBe(false);
  await expect(openDialogs(page)).toHaveCount(1);
  expect(state.writes).toHaveLength(0);
  expect(state.errors).toEqual([]);
});

test("#229 업무 확인의 서버 메모 오류는 해당 입력에 표시하고 수정 후 저장", async ({ page }) => {
  const state = await fixtures(page), submitted: Record<string, unknown>[] = [];
  await page.route("**/api/tasks/*", (route) => {
    if (route.request().method() !== "PATCH") return route.fallback();
    submitted.push(route.request().postDataJSON());
    return submitted.length === 1
      ? route.fulfill({
        status: 422,
        json: {
          code: "invalid_input",
          message: "기록 메모를 확인하세요",
          fields: [{ path: "change_note", message: "근거를 보완하세요" }],
        },
      })
      : route.fallback();
  });
  await go(page, `/tasks/${id(2)}?edit=1`);
  await form(page).getByRole("textbox", { name: "제목 (필수)", exact: true }).fill("변경한 할 일");
  await form(page).getByRole("button", { name: "저장", exact: true }).click();
  await form(page).getByLabel("기록 메모", { exact: true }).fill("초안 메모");
  await form(page).getByRole("button", { name: "수정하고 저장", exact: true }).click();
  await expect(form(page).getByLabel("기록 메모", { exact: true })).toHaveAttribute("aria-invalid", "true");
  await expect(form(page).getByText("근거를 보완하세요", { exact: true })).toBeVisible();
  await expect(form(page).getByLabel("기록 메모", { exact: true })).toBeEnabled();
  await form(page).getByLabel("기록 메모", { exact: true }).fill("보완한 근거");
  await form(page).getByRole("button", { name: "수정하고 저장", exact: true }).click();
  await expect(form(page).getByRole("button", { name: "편집", exact: true })).toBeVisible();
  expect(submitted.map((body) => body.change_note)).toEqual(["초안 메모", "보완한 근거"]);
  expect(submitted[1].expected_version).toBe(submitted[0].expected_version);
  expect(state.errors).toEqual([]);
});

for (const [kind, label] of [["entities", "자료 태그"], ["tasks", "할 일 태그"], ["records", "기록 태그"]] as const) {
  test(`${kind}: tag connection clear stays outside choices, keeps the group name and only updates the draft`, async ({ page }) => {
    const state = await fixtures(page);
    await go(page, `/${kind}/${kind === "entities" ? encodeURIComponent(entityKey(1)) : id(kind === "tasks" ? 2 : 3)}`);
    await form(page).getByRole("button", { name: "태그 연결", exact: true }).click();
    const picker = form(page).getByRole("group", { name: "태그", exact: true });
    const choice = picker.getByRole("button", { name: "같은 이름 선택 해제", exact: true });
    const clear = picker.getByRole("button", { name: "모든 태그 선택 해제", exact: true });
    await expect(clear).toHaveCount(0);
    await chooseTag(page, picker, "같은 이름");
    await expect(choice).toHaveCount(1);
    await expect(picker).toHaveAccessibleName("태그");
    await expect(picker.locator('[aria-label="선택한 태그"]').getByRole("button", { name: "모든 태그 선택 해제" })).toHaveCount(0);
    await clear.click();
    await expect(clear).toHaveCount(0);
    await expect(choice).toHaveCount(0);
    await expect(picker.getByRole("button", { name: "태그 선택", exact: true })).toBeFocused();
    expect(state.writes).toHaveLength(0);
    expect(state.errors).toEqual([]);
  });
}

test("failed tag lookup still permits clearing existing draft selections", async ({ page }) => {
  const state = await fixtures(page);
  await go(page, `/tasks/${id(2)}?edit=1`);
  await form(page).getByRole("textbox", { name: /^제목/ }).fill("태그 초안 검사");
  await form(page).getByRole("button", { name: "저장", exact: true }).click();
  const picker = form(page).getByRole("group", { name: "기록 태그", exact: true });
  const choice = picker.getByRole("button", { name: "같은 이름 선택 해제", exact: true });
  await chooseTag(page, picker, "같은 이름");
  await expect(choice).toHaveCount(1);
  let failedReads = 0;
  await page.route("**/api/tags**", route => {
    failedReads++;
    return route.fulfill({ status: 503, json: { error: { code: "unavailable", message: "fixture lookup failed", fields: [] } } });
  });
  // Returning to the window refreshes the dictionary while the new record's actual UI selection remains a draft.
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => failedReads).toBeGreaterThan(0);
  await expect(picker.getByRole("alert")).toContainText("기존 선택은 유지합니다");
  await expect(picker).toHaveAccessibleName("기록 태그");
  await expect(choice).toHaveCount(1);
  await expect(picker.locator('[aria-label="선택한 태그"]').getByRole("button", { name: "모든 태그 선택 해제" })).toHaveCount(0);
  await picker.getByRole("button", { name: "모든 태그 선택 해제", exact: true }).click();
  await expect(picker.getByRole("button", { name: "모든 태그 선택 해제", exact: true })).toHaveCount(0);
  await expect(choice).toHaveCount(0);
  await expect(picker.getByRole("button", { name: "태그 선택", exact: true })).toBeFocused();
  expect(state.writes).toHaveLength(0);
});

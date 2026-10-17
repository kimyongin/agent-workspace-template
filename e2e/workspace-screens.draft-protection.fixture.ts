import { openDialogs } from "./ui-actions.ts";
import { entityKey } from "./support/workspace-data.ts";
import { fillChangeMemo, openListDetail, openListEditor } from "./ui-actions.ts";
import { beginTabAction, discardEditor, saveOnce } from "./ui-actions.ts";
import { expect, test } from "@playwright/test";
import { id } from "./support/workspace-data.ts";
import { compatibleEdit, fillText, fixtures, form, go } from "./support/workspace-screens.ts";

for (const [kind, label] of [["entities", "검사 자료"], ["tasks", "할 일"], ["records", "기록"]]) {
  test(`${kind}: uncertain 생성 폐기 후 새 작성은 새로운 요청키`, async ({ page }) => {
    const state = await fixtures(page, { failWrite: "unknown" });
    await go(page, `/${kind}`);
    const begin = () =>
      beginTabAction(
        page,
        kind === "records" ? "기록 작성" : `${label} 추가`,
      );
    const fill = async (value: string) => {
      if (kind === "entities") await form(page).getByLabel("제목", { exact: false }).fill(value);
      else await fillText(page, value);
    };
    const submit = () => saveOnce(page, form(page), kind === "tasks" ? "추가" : "저장");
    await begin();
    await fill("첫 작성");
    await submit();
    await expect(form(page).getByRole("button", { name: "같은 내용 다시 시도" })).toBeVisible();
    await discardEditor(page);
    await page.getByRole("alertdialog", { name: "변경을 버릴까요?" }).getByRole("button", { name: "변경 버리기" }).click();
    await expect(form(page)).toHaveCount(0);
    await begin();
    await fill("새 작성");
    await submit();
    await expect.poll(() => state.writes.length).toBe(2);
    expect(state.writes[1].requestKey).not.toBe(state.writes[0].requestKey);
    expect(state.writes[1].body).not.toHaveProperty("id");
    expect(state.errors).toEqual([]);
  });
}

for (const [kind, n] of [["entities", 1], ["tasks", 2], ["records", 3]] as const) {
  test(`${kind}: uncertain 편집 폐기 후 새 편집은 같은 버전에 새 메모`, async ({ page }) => {
    const state = await fixtures(page, { failWrite: "unknown" });
    await go(page, `/${kind}/${kind === "entities" ? encodeURIComponent(entityKey(n)) : id(n)}`);
    await compatibleEdit(page);
    if (kind === "records") await form(page).getByLabel("본문", { exact: false }).fill("첫 수정");
    else await fillChangeMemo(page, form(page), "첫 수정");
    await saveOnce(page, form(page));
    await expect(form(page).getByRole("button", { name: "같은 내용 다시 시도" })).toBeVisible();
    await discardEditor(page);
    await page.getByRole("alertdialog", { name: "변경을 버릴까요?" }).getByRole("button", { name: "변경 버리기" }).click();
    await go(page, `/${kind}/${kind === "entities" ? encodeURIComponent(entityKey(n)) : id(n)}`);
    await compatibleEdit(page);
    if (kind === "records") await form(page).getByLabel("본문", { exact: false }).fill("새 수정");
    else await fillChangeMemo(page, form(page), "새 수정");
    await saveOnce(page, form(page));
    await expect.poll(() => state.writes.length).toBe(2);
    expect(state.writes[1].body.expected_version).toBe(state.writes[0].body.expected_version);
    expect(state.writes[1].body[kind === "records" ? "body" : "change_note"]).toBe("새 수정");
    expect(state.errors).toEqual([]);
  });
}

test("dirty 작성 조건 이동 승인: create 유지 URL도 새 초안", async ({ page }) => {
  const state = await fixtures(page);
  await go(page, "/tasks?create=1");
  await fillText(page, "버릴 작성 초안");
  // The official modal hides background links; deliberately exercise the fixture router's guard.
  await page.getByRole("link", { name: "작성 조건 변경 fixture", includeHidden: true }).evaluate((el) =>
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
  );
  const confirm = page.getByRole("alertdialog", { name: "변경을 버릴까요?" });
  await confirm.getByRole("button", { name: "변경 버리기" }).click();
  await expect(page).toHaveURL(/tasks\?create=1&kind=recurring$/);
  await expect(form(page).getByRole("textbox", { name: /^제목(?: \(필수\))?$/ })).toHaveValue("");
  expect(state.errors).toEqual([]);
});

for (const [kind, label, submit] of [["task", "할 일 작성", "추가"], ["record", "기록 작성", "저장"]]) {
  test(`엔터티 관련 ${kind}: uncertain 폐기 후 새 작성은 새 요청키`, async ({ page }) => {
    const state = await fixtures(page, { failWrite: "unknown" });
    await go(page, `/entities/${encodeURIComponent(entityKey(1))}`);
    await form(page).getByRole("button", { name: label, exact: true }).click();
    await fillText(page, "첫 연결 작성");
    await saveOnce(page, form(page), submit);
    await expect(form(page).getByRole("button", { name: "같은 내용 다시 시도" })).toBeVisible();
    await discardEditor(page);
    await page.getByRole("alertdialog", { name: "변경을 버릴까요?" }).getByRole("button", { name: "변경 버리기" }).click();
    await expect(page).not.toHaveURL(/create=/);
    await go(page, `/entities/${encodeURIComponent(entityKey(1))}`);
    await form(page).getByRole("button", { name: label, exact: true }).click();
    await fillText(page, "새 연결 작성");
    await saveOnce(page, form(page), submit);
    await expect.poll(() => state.writes.length).toBe(2);
    expect(state.writes[1].requestKey).not.toBe(state.writes[0].requestKey);
    expect(state.writes[1].body).not.toHaveProperty("id");
    expect(state.errors).toEqual([]);
  });
}

test("엔터티 create/edit 복합 직접 링크는 연결 작성 한 폼만 연다", async ({ page }) => {
  const state = await fixtures(page);
  await go(page, `/entities/${encodeURIComponent(entityKey(1))}?create=task&edit=1`);
  await expect(form(page)).toHaveCount(1);
  await expect(form(page).getByRole("textbox", { name: /^제목(?: \(필수\))?$/ })).toBeVisible();
  await expect(form(page).getByLabel("자료 번호", { exact: true })).toHaveCount(0);
  await expect(form(page).getByLabel("수량", { exact: false })).toHaveCount(0);
  await fillText(page, "연결 작성 한 번");
  await saveOnce(page, form(page), "추가");
  await expect.poll(() => state.writes.length).toBe(1);
  expect(state.writes[0].body.entity_ids).toEqual([entityKey(1)]);
  expect(state.errors).toEqual([]);
});

for (const [kind, label] of [["task", "할 일 작성"], ["record", "기록 작성"]] as const) {
  test(`자료 연결 ${kind}: 취소·폐기 승인은 작성 URL을 닫고 reload는 읽기`, async ({ page }) => {
    const state = await fixtures(page);
    await go(page, `/entities/${encodeURIComponent(entityKey(1))}?list=%2Fentities%3Fq%3D%EC%97%94%ED%84%B0%ED%8B%B0`);
    for (const dirty of [false, true]) {
      await form(page).getByRole("button", { name: label, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`create=${kind}`));
      if (dirty) await fillText(page, "폐기할 연결 작성");
      await form(page).getByRole("button", { name: "취소", exact: true }).click();
      if (dirty) {
        const confirm = page.getByRole("alertdialog", { name: "변경을 버릴까요?" });
        await confirm.getByRole("button", { name: "취소", exact: true }).click();
        await expect(form(page).getByRole("textbox", { name: kind === "record" ? /^본문/ : /^제목/ })).toHaveValue(
          "폐기할 연결 작성",
        );
        await form(page).getByRole("button", { name: "취소", exact: true }).click();
        await confirm.getByRole("button", { name: "변경 버리기" }).click();
      }
      await expect(page).not.toHaveURL(/create=/);
      await expect(page).toHaveURL(/list=/);
      await expect(form(page).getByRole("button", { name: label, exact: true })).toBeFocused();
    }
    await page.reload();
    await expect(form(page).getByRole("button", { name: label, exact: true })).toBeVisible();
    await expect(form(page).getByRole("textbox", { name: /^제목(?: \(필수\))?$/ })).toHaveCount(0);
    expect(state.writes).toHaveLength(0);
    expect(state.errors).toEqual([]);
  });
}

test("엔터티 관련 작성은 URL·뒤로가기 초안 보호·reload·같은 surface 저장", async ({ page }) => {
  const state = await fixtures(page);
  await go(page, "/entities");
  await openListDetail(page, "자료");
  await form(page).getByRole("button", { name: "할 일 작성", exact: true }).click();
  await expect(page).toHaveURL(/create=task/);
  await expect(form(page)).toHaveCount(1);
  await fillText(page, "연결 업무");
  await page.goBack();
  const confirm = page.getByRole("alertdialog", { name: "변경을 버릴까요?" });
  await confirm.getByRole("button", { name: "취소", exact: true }).click();
  await expect(form(page).getByRole("textbox", { name: /^제목(?: \(필수\))?$/ })).toHaveValue("연결 업무");
  await saveOnce(page, form(page), "추가");
  await expect(page).not.toHaveURL(/create=/);
  expect(state.writes[0].body.entity_ids).toEqual([entityKey(1)]);
  await expect(form(page)).not.toContainText("할 일을 추가했습니다.");
  await expect(form(page).getByRole("button", { name: "할 일 작성", exact: true })).toBeFocused();
  await form(page).getByRole("button", { name: "기록 작성", exact: true }).click();
  await page.reload();
  await expect(form(page).getByLabel("본문")).toHaveValue("");
  expect(state.errors).toEqual([]);
});

for (const width of [390, 1440]) {
  test(`기록 편집 POP 재조회 실패 ${width}px: 원문·업무·실패와 재시도 복원`, async ({ page }) => {
    const state = await fixtures(page);
    await page.setViewportSize({ width, height: 900 });
    let failed = false, reads = 0;
    await page.route(`**/api/records/${id(3)}`, (route) => {
      reads++;
      return failed
        ? route.fulfill({ status: 503, json: { code: "internal", message: "reload failed" } })
        : route.fulfill({ json: state.rows.records[0] });
    });
    await go(page, `/records/${id(3)}`);
    await expect(form(page).locator(".markdown")).toBeVisible();
    failed = true;
    await page.evaluate(() => {
      history.pushState(
        { ...history.state, idx: (history.state?.idx ?? 0) + 1 },
        "",
        location.pathname + "?edit=1&edit_from=view",
      );
      dispatchEvent(new PopStateEvent("popstate", { state: history.state }));
    });
    await expect(form(page).getByRole("alert")).toHaveText("기록을 불러오지 못했습니다.");
    await expect(form(page).locator(".markdown")).toBeVisible();
    await expect(form(page).getByRole("button", { name: "조회 다시 시도", exact: true })).toBeVisible();
    await expect(form(page).getByRole("button", { name: "저장", exact: true })).toHaveCount(0);
    await expect(page).toHaveURL(/edit=1/);
    expect(reads).toBe(2);
    expect(state.writes).toHaveLength(0);
    failed = false;
    state.rows.records[0].body = "새 서버 원문";
    state.rows.records[0].version = 2;
    await form(page).getByRole("button", { name: "조회 다시 시도", exact: true }).click();
    await expect(form(page).getByRole("alert")).toHaveCount(0);
    await expect(form(page).getByLabel("본문")).toHaveValue("새 서버 원문");
    await expect(form(page).getByRole("button", { name: "삭제", exact: true })).toBeVisible();
    expect(reads).toBe(3);
    await form(page).getByRole("button", { name: "취소", exact: true }).click();
    await expect(page).not.toHaveURL(/edit=1/);
    await expect(form(page).locator(".markdown")).toHaveText("새 서버 원문");
    await expect(form(page).getByRole("button", { name: "편집", exact: true })).toBeVisible();
    expect(state.writes).toHaveLength(0);
    expect(state.errors).toEqual([]);
  });
}

for (const failure of ["unknown", "conflict"] as const) {
  test(`편집 ${failure}: 초안·중복 요청키·Escape 확인 취소`, async ({ page }) => {
    const state = await fixtures(page, { failWrite: failure });
    await go(page, `/tasks/${id(2)}?edit=1`);
    await form(page).getByRole("textbox", { name: /^제목(?: \(필수\))?$/ }).fill("보존할 초안");
    await fillChangeMemo(page, form(page), "정정 이유");
    await saveOnce(page, form(page));
    await expect(form(page).getByRole("alert")).toBeVisible();
    await discardEditor(page);
    const confirm = page.getByRole("alertdialog", { name: "변경을 버릴까요?" });
    await confirm.getByRole("button", { name: "취소", exact: true }).click();
    await expect(form(page).getByRole("textbox", { name: /^제목(?: \(필수\))?$/ })).toHaveValue("보존할 초안");
    if (failure === "unknown") {
      await expect(form(page).getByRole("textbox", { name: /^제목(?: \(필수\))?$/ })).toBeDisabled();
      await form(page).getByRole("button", { name: "같은 내용 다시 시도" }).click();
      await saveOnce(page, form(page));
      expect(state.writes[1].body).toEqual(state.writes[0].body);
      expect(state.writes[1].requestKey).toBe(state.writes[0].requestKey);
      expect(state.writes[0].requestKey).toMatch(/^[0-9a-f-]{36}$/);
    }
    expect(state.errors).toEqual([]);
  });
}

test("busy POP·dirty back/forward·reload·직접 링크", async ({ page }) => {
  const state = await fixtures(page, { hold: true });
  await go(page, "/tasks");
  await openListEditor(page, "할 일");
  await fillChangeMemo(page, form(page), "저장 이유");
  await saveOnce(page, form(page), "저장", false);
  await state.pending;
  await page.goBack();
  await expect(page).toHaveURL(/edit=1/);
  await expect(page.getByRole("alertdialog", { name: "변경을 버릴까요?" })).not.toBeVisible();
  state.release();
  await expect(form(page).getByRole("button", { name: "편집", exact: true })).toBeVisible();
  await form(page).getByRole("button", { name: "닫기", exact: true }).click();
  await openListEditor(page, "할 일");
  await form(page).getByRole("textbox", { name: /^제목(?: \(필수\))?$/ }).fill("버리지 않을 초안");
  await page.goBack();
  const confirm = page.getByRole("alertdialog", { name: "변경을 버릴까요?" });
  await confirm.getByRole("button", { name: "취소", exact: true }).click();
  await expect(form(page).getByRole("textbox", { name: /^제목(?: \(필수\))?$/ })).toHaveValue("버리지 않을 초안");
  await page.goBack();
  await confirm.getByRole("button", { name: "변경 버리기" }).click();
  await expect(page).toHaveURL(/\/tasks\?/);
  await page.goForward();
  await expect(form(page).getByRole("textbox", { name: /^제목(?: \(필수\))?$/ })).toHaveValue("할 일");
  await page.reload();
  await expect(form(page).getByRole("textbox", { name: /^제목(?: \(필수\))?$/ })).toHaveValue("할 일");
  expect(state.errors).toEqual([]);
});

test("저장 성공 후 GET 실패·조회만 재시도·서버 conflict 초안 유지", async ({ page }) => {
  const state = await fixtures(page);
  let fail = false, patches = 0;
  await page.route(`**/api/tasks/${id(2)}`, async (route) => {
    if (route.request().method() === "PATCH") {
      patches++;
      Object.assign(state.rows.tasks[0], route.request().postDataJSON(), { version: 2 });
      fail = true;
      await route.fulfill({ json: state.rows.tasks[0] });
      return;
    }
    if (fail) {
      await route.fulfill({ status: 503, json: { code: "internal", message: "fixture GET failure" } });
      return;
    }
    await route.fulfill({ json: state.rows.tasks[0] });
  });
  await go(page, `/tasks/${id(2)}`);
  await compatibleEdit(page);
  await form(page).getByRole("textbox", { name: /^제목(?: \(필수\))?$/ }).fill("최신 내용");
  await fillChangeMemo(page, form(page), "수정 사유");
  await saveOnce(page, form(page));
  await expect(form(page).getByText("저장은 완료했습니다. 최신 내용을 불러오지 못했습니다.")).toBeVisible();
  await expect(form(page).getByRole("heading", { name: "최신 내용", exact: true })).toBeVisible();
  fail = false;
  await form(page).getByRole("button", { name: "조회 다시 시도" }).click();
  await expect(form(page).getByText("저장은 완료했습니다. 최신 내용을 불러오지 못했습니다.")).toHaveCount(0);
  expect(patches).toBe(1);
  expect(state.errors).toEqual([]);
});

test("#229 엔터티 관련 작성 취소는 직접 편집 의도와 목록 문맥을 보존", async ({ page }) => {
  const state = await fixtures(page);
  const list = `/entities?pages=2&scroll=83#entity-${encodeURIComponent(entityKey(1))}`;
  await go(
    page,
    `/entities/${encodeURIComponent(entityKey(1))}?edit=1&edit_from=view&create=record&list=${
      encodeURIComponent(list)
    }`,
  );
  await expect(form(page)).toHaveAccessibleName("기록 작성");
  await form(page).getByRole("button", { name: "취소", exact: true }).click();
  await expect(form(page).getByRole("textbox", { name: "제목 (필수)", exact: true })).toBeVisible();
  await form(page).getByRole("button", { name: "취소", exact: true }).click();
  await expect(form(page).getByRole("button", { name: "편집", exact: true })).toBeVisible();
  const url = new URL(page.url());
  expect(url.searchParams.get("list")).toBe(list);
  for (const key of ["edit", "edit_from", "create"]) expect(url.searchParams.has(key)).toBe(false);
  await expect(openDialogs(page)).toHaveCount(1);
  expect(state.writes).toHaveLength(0);
  expect(state.errors).toEqual([]);
});

test("미확정 저장 새로고침: 최소 메타데이터만 보관하고 자동 재전송하지 않는다", async ({ page }) => {
  const state = await fixtures(page, { failWrite: "unknown" });
  await go(page, "/tasks");
  await beginTabAction(page, "할 일 추가");
  await fillText(page, "비공개 초안 본문");
  await saveOnce(page, form(page), "추가");
  await expect(form(page).getByRole("button", { name: "같은 내용 다시 시도" })).toBeVisible();
  const stored = await page.evaluate(() =>
    Object.entries(sessionStorage).filter(([key]) => key.startsWith("workspace:unresolved-write:")).map(([, value]) =>
      JSON.parse(value)
    )
  );
  expect(stored).toHaveLength(1);
  expect(Object.keys(stored[0]).sort()).toEqual(["operation", "request_key", "status", "target"]);
  expect(JSON.stringify(stored)).not.toContain("비공개 초안 본문");
  await page.reload();
  await expect(page.getByRole("alert").filter({ hasText: "이전 저장 결과" })).toBeVisible();
  expect(state.writes).toHaveLength(1);
  expect(state.errors).toEqual([]);
});

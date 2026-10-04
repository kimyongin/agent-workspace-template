import { expect, test } from "@playwright/test";
const url = "/e2e/fixtures/entity-tags.html";
const tags = ["첫 태그", "다른 태그"].map((name, i) => ({ id: `00000000-0000-4000-8000-00000000000${i}`, name, version: 1, created_at: "2026-10-04T00:00:00Z", updated_at: "2026-10-04T00:00:00Z" }));
const task = { id: "20000000-0000-4000-8000-000000000000", entity_id: null, tag_ids: [], kind: "once", title: "App 할 일", summary: "실제 라우터 fixture", body: "본문", due_on: null, recurrence: null, timezone: null, status: "open", completed_at: null, result_record_id: null, pauses: [], version: 1, created_at: tags[0].created_at, updated_at: tags[0].updated_at, occurrence: null, result_record: null };
test.beforeEach(async ({ page }) => { await page.route("**/api/tags**", route => route.fulfill({ json: { items: tags, next_cursor: null } })); });
test("태그 한 초안 선택 전환과 경로·뒤로가기 폐기 취소", async ({ page }, info) => {
  await page.goto(url + "?before=1"); await page.getByRole("link", { name: "다른 화면" }).click();
  await page.getByRole("button", { name: "첫 태그 이름 변경" }).click(); await page.getByRole("textbox", { name: /태그 이름/ }).fill("초안");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("tag-editor.png"), fullPage: true });
  await page.getByRole("button", { name: "다른 태그 이름 변경" }).click();
  let confirm = page.getByRole("dialog", { name: "변경을 버릴까요?" }); await confirm.getByRole("button", { name: "취소", exact: true }).click();
  await expect(page.getByRole("textbox", { name: /태그 이름/ })).toHaveValue("초안");
  await page.goBack(); await expect(confirm).toBeVisible(); await confirm.getByRole("button", { name: "취소", exact: true }).click();
  await expect(page).toHaveURL(/view=other/); await expect(page.getByRole("textbox", { name: /태그 이름/ })).toHaveValue("초안");
  await page.getByRole("link", { name: "다른 화면" }).click(); await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "변경 버리기" }).click();
  await expect(page.getByRole("textbox", { name: /태그 이름/ })).toHaveCount(0);
});
test("공통 모달 같은 경로 query 폐기는 순수 닫기만 실행하고 의도한 목적지 유지", async ({ page }) => {
  await page.goto(url);
  // fixture router의 링크로 진입해 같은 컴포넌트 재사용을 검사한다.
  await page.getByRole("link", { name: "모달 회귀" }).click();
  const form = page.getByRole("dialog", { name: "경로 폐기 회귀" }); await form.getByLabel("회귀 초안").fill("폐기할 내용"); await form.getByRole("link", { name: "같은 모달 화면 이동" }).click();
  const confirm = page.getByRole("dialog", { name: "변경을 버릴까요?" }); await confirm.getByRole("button", { name: "취소", exact: true }).click(); await expect(form.getByLabel("회귀 초안")).toHaveValue("폐기할 내용");
  await form.getByRole("link", { name: "같은 모달 화면 이동" }).click(); await confirm.getByRole("button", { name: "변경 버리기" }).click();
  await expect(form).not.toBeVisible(); await expect(page).toHaveURL(/\/modal-guard\?intended=1$/); await expect(page).not.toHaveURL(/ordinary-close/);
});
test("태그 중복 이름 생성/변경은 이름 정정 후 저장하며 expected_version 유지", async ({ page }) => {
  const writes: Record<string, unknown>[] = [];
  await page.route("**/api/tags**", route => {
    if (["POST", "PATCH"].includes(route.request().method())) {
      const body = route.request().postDataJSON(); writes.push(body);
      if (body.name === "중복 이름") return route.fulfill({ status: 409, json: { code: "conflict", message: "같은 이름의 태그가 있습니다" } });
      return route.fulfill({ status: 201, json: { ...tags[0], name: body.name } });
    }
    return route.fulfill({ json: { items: tags, next_cursor: null } });
  });
  await page.goto(url);
  for (const action of ["태그 추가", "첫 태그 이름 변경"]) {
    await page.getByRole("button", { name: action, exact: true }).click(); const name = page.getByRole("textbox", { name: /태그 이름/ }); await name.fill("중복 이름"); await page.getByRole("button", { name: "저장", exact: true }).click();
    await expect(page.getByRole("button", { name: "저장", exact: true })).toBeEnabled(); await expect(page.getByText(/취소 후 최신 태그/)).toHaveCount(0);
    await name.fill("정정한 이름"); await page.getByRole("button", { name: "저장", exact: true }).click(); await expect(page.getByText("태그를 저장했습니다.")).toBeVisible();
  }
  expect(writes[2].expected_version).toBe(1); expect(writes[3].expected_version).toBe(1);
});
test("저장 뒤 재조회가 이전 더 보기 응답을 무시하고 새 경계 cursor 유지", async ({ page }) => {
  const tail = { ...tags[0], id: "40000000-0000-4000-8000-000000000000", name: "끝 태그" }, added = { ...tags[0], id: "50000000-0000-4000-8000-000000000000", name: "새 항목" };
  let created = false, release = () => {}, arrived = () => {}; const started = new Promise<void>(resolve => { arrived = resolve; });
  await page.route("**/api/tags**", async route => {
    if (route.request().method() === "POST") { created = true; await route.fulfill({ status: 201, json: added }); return; }
    const cursor = new URL(route.request().url()).searchParams.get("cursor");
    if (cursor === "old") { arrived(); await new Promise<void>(resolve => { release = resolve; }); await route.fulfill({ json: { items: [tail], next_cursor: null } }).catch(() => {}); }
    else await route.fulfill({ json: cursor === "fresh" ? { items: [tags[1], tail], next_cursor: null } : { items: created ? [added, tags[0]] : tags, next_cursor: created ? "fresh" : "old" } });
  });
  await page.goto(url); await page.getByRole("button", { name: "더 보기", exact: true }).click(); await started;
  await page.getByRole("button", { name: "태그 추가", exact: true }).click(); await page.getByRole("textbox", { name: /태그 이름/ }).fill("새 항목"); await page.getByRole("button", { name: "저장", exact: true }).click(); await expect(page.getByText("태그를 저장했습니다.")).toBeVisible();
  await expect(page.getByRole("button", { name: "더 보기", exact: true })).toBeEnabled(); release();
  await page.getByRole("button", { name: "더 보기", exact: true }).click(); await expect(page.getByRole("button", { name: "다른 태그 이름 변경" })).toBeVisible(); await expect(page.getByRole("button", { name: "끝 태그 이름 변경" })).toBeVisible(); await expect(page.locator("button[id^='tag-']")).toHaveCount(4);
});
test("실제 App에서 태그 dirty 주 탐색·뒤로가기·앞으로가기 취소", async ({ page }) => {
  await page.route("**/api/tasks**", route => route.fulfill({ json: { items: [task], next_cursor: null } }));
  await page.route("**/api/entities**", route => route.fulfill({ json: { items: [], next_cursor: null } }));
  await page.goto("/e2e/fixtures/entity-tags-app.html"); await expect(page.getByRole("heading", { name: "할 일", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "더보기", exact: true }).click(); await page.getByRole("link", { name: "태그 관리", exact: true }).click();
  await page.getByRole("button", { name: "태그 추가", exact: true }).click(); await page.getByRole("textbox", { name: /태그 이름/ }).fill("앱 초안");
  await page.getByRole("navigation", { name: "주 메뉴" }).getByRole("link", { name: "활동", exact: true }).click();
  const discard = page.getByRole("dialog", { name: "변경을 버릴까요?" }); await discard.getByRole("button", { name: "취소", exact: true }).click();
  await expect(page).toHaveURL(/\/tags$/); await expect(page.getByRole("textbox", { name: /태그 이름/ })).toHaveValue("앱 초안");
  await page.goBack(); await discard.getByRole("button", { name: "취소", exact: true }).click(); await expect(page).toHaveURL(/\/tags$/);
  await page.getByRole("button", { name: "더보기", exact: true }).click(); await page.getByRole("link", { name: "로그아웃", exact: true }).click();
  await discard.getByRole("button", { name: "취소", exact: true }).click(); await expect(page).toHaveURL(/\/tags$/);
  expect(await page.evaluate(() => !!localStorage.getItem("sb-127-auth-token"))).toBe(true); await expect(page.getByRole("textbox", { name: /태그 이름/ })).toHaveValue("앱 초안");
  await page.goBack(); await discard.getByRole("button", { name: "변경 버리기" }).click(); await expect(page).toHaveURL(/\/tasks$/);
  await page.getByRole("button", { name: "할 일 추가", exact: true }).click(); const form = page.getByRole("dialog", { name: "할 일 추가", exact: true }); await form.getByLabel("제목").fill("새 초안");
  await page.goForward(); await discard.getByRole("button", { name: "취소", exact: true }).click(); await expect(page).toHaveURL(/\/tasks$/); await expect(form.getByLabel("제목")).toHaveValue("새 초안");
});
test("실제 App 공통 모달 생성·직접 편집 성공/취소·저장 중 POP 취소", async ({ page }) => {
  let current = { ...task }, hold = false, release = () => {}, arrived = () => {}; const started = new Promise<void>(resolve => { arrived = resolve; }); const warnings: string[] = [];
  page.on("console", message => { if (/one blocker|Maximum update|unmounted/.test(message.text())) warnings.push(message.text()); });
  await page.route("**/api/entities**", route => route.fulfill({ json: { items: [], next_cursor: null } }));
  await page.route("**/api/tasks**", async route => {
    const request = route.request();
    if (request.method() === "POST") { if (hold) { arrived(); await new Promise<void>(resolve => { release = resolve; }); } current = { ...current, ...request.postDataJSON() }; await route.fulfill({ status: 201, json: current }); }
    else if (request.method() === "PATCH") { current = { ...current, ...request.postDataJSON(), version: current.version + 1 }; await route.fulfill({ json: current }); }
    else await route.fulfill({ json: new URL(request.url()).pathname.endsWith(task.id) ? current : { items: [current], next_cursor: null } });
  });
  await page.goto("/e2e/fixtures/entity-tags-app.html"); await expect(page.getByRole("heading", { name: "할 일", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "더보기", exact: true }).click(); await page.getByRole("link", { name: "태그 관리", exact: true }).click();
  await page.getByRole("navigation", { name: "주 메뉴" }).getByRole("link", { name: "활동", exact: true }).click();
  await page.getByRole("button", { name: "할 일 추가", exact: true }).click(); let form = page.getByRole("dialog", { name: "할 일 추가", exact: true }); await form.getByLabel("제목").fill("생성 결과"); await form.getByLabel("요약").fill("생성 요약");
  hold = true; await form.getByRole("button", { name: "추가", exact: true }).click(); await expect(form.getByRole("button", { name: "저장 중…", exact: true })).toBeDisabled();
  await started;
  await page.goBack(); await expect(page).toHaveURL(/\/tasks$/); await expect(page.getByRole("dialog", { name: "변경을 버릴까요?" })).not.toBeVisible();
  release(); await expect(page).toHaveURL(new RegExp(`/tasks/${task.id}$`)); await expect(form).not.toBeVisible();
  await page.getByRole("link", { name: "← 할 일 목록", exact: true }).click(); await page.getByRole("link", { name: "생성 결과 편집", exact: true }).click();
  form = page.getByRole("dialog", { name: "할 일 편집", exact: true }); await form.getByRole("button", { name: "취소", exact: true }).click(); await expect(page).toHaveURL(/\/tasks\?/); await expect(form).not.toBeVisible();
  await page.getByRole("link", { name: "생성 결과 편집", exact: true }).click(); await form.getByLabel("요약").fill("직접 편집 성공"); await form.getByRole("button", { name: "저장", exact: true }).click();
  await expect(page).toHaveURL(/\/tasks\?/); await expect(form).not.toBeVisible(); await expect(page.getByText("직접 편집 성공", { exact: true })).toBeVisible(); expect(warnings).toEqual([]);
  const entity = { id: "30000000-0000-4000-8000-000000000000", prop1: "App 엔터티", prop2: null, prop3: null, prop4: "a", version: 1, created_at: task.created_at, updated_at: task.updated_at, tasks: { count: 0, items: [] }, records: { count: 0, items: [] }, principles: { count: 0, items: [] } };
  await page.route("**/api/entities**", route => route.fulfill({ json: route.request().method() === "POST" || new URL(route.request().url()).pathname.endsWith(entity.id) ? entity : { items: [], next_cursor: null } }));
  await page.getByRole("navigation", { name: "주 메뉴" }).getByRole("link", { name: "엔터티", exact: true }).click(); await page.getByRole("button", { name: "엔터티 추가", exact: true }).click();
  const entityForm = page.getByRole("dialog", { name: "엔터티 추가", exact: true }); await entityForm.getByLabel("속성 1").fill(entity.prop1); await entityForm.getByRole("button", { name: "저장", exact: true }).click();
  await expect(entityForm).not.toBeVisible(); await expect(page).toHaveURL(new RegExp(`/entities/${entity.id}`)); await expect(page.getByRole("heading", { name: entity.prop1 })).toBeVisible();
});
test("불확정 이름 변경을 최신 목록에서 확인하며 중복 PATCH 안 함", async ({ page }) => {
  let patches = 0, updated = false;
  await page.route("**/api/tags**", route => {
    if (route.request().method() === "PATCH") { patches++; updated = true; return route.abort(); }
    return route.fulfill({ json: { items: tags.map(t => updated && t.id === tags[0].id ? { ...t, name: "정정 이름", version: 2 } : t), next_cursor: null } });
  });
  await page.goto(url); await page.getByRole("button", { name: "첫 태그 이름 변경" }).click(); await page.getByRole("textbox", { name: /태그 이름/ }).fill("정정 이름"); await page.getByRole("button", { name: "저장", exact: true }).click();
  await page.getByRole("button", { name: "같은 내용 다시 시도" }).click(); await expect(page.getByText("태그를 저장했습니다.")).toBeVisible(); expect(patches).toBe(1);
});
test("불확정 생성 같은 request_id 재시도와 성공 뒤 목록 실패 구분", async ({ page }) => {
  let calls = 0; const bodies: Record<string, unknown>[] = []; let saved = false;
  await page.route("**/api/tags", async route => {
    if (route.request().method() === "POST") { bodies.push(route.request().postDataJSON()); calls++; if (calls === 1) await route.abort(); else { saved = true; await route.fulfill({ status: 201, json: { ...tags[0], name: "새 태그" } }); } }
    else await route.fulfill(saved ? { status: 503, json: { code: "internal", message: "목록 실패" } } : { json: { items: tags, next_cursor: null } });
  });
  await page.goto(url); await page.getByRole("button", { name: "태그 추가", exact: true }).click(); await page.getByRole("textbox", { name: /태그 이름/ }).fill("새 태그"); await page.getByRole("button", { name: "저장", exact: true }).click();
  await expect(page.getByText(/저장 여부를 알 수 없습니다/)).toBeVisible(); await expect(page.getByRole("textbox", { name: /태그 이름/ })).toHaveAttribute("readonly", "");
  await page.getByRole("button", { name: "같은 내용 다시 시도" }).click();
  await expect(page.getByText("태그를 저장했습니다.")).toBeVisible(); await expect(page.getByText(/태그 목록을 불러오지 못했습니다/)).toBeVisible(); expect(bodies[1]).toEqual(bodies[0]);
  await expect(page.getByRole("button", { name: "새 태그 이름 변경" })).toBeFocused();
});
test("이름 충돌 초안 보존과 삭제 실패·성공", async ({ page }) => {
  let failedDelete = true, conflicted = false;
  await page.route("**/api/tags", route => route.fulfill({ json: { items: tags.map(t => conflicted && t.id === tags[0].id ? { ...t, version: 2 } : t), next_cursor: null } }));
  await page.route("**/api/tags/*", route => { if (route.request().method() === "PATCH") { conflicted = true; return route.fulfill({ status: 409, json: { code: "conflict", message: "다른 변경" } }); } return failedDelete ? route.fulfill({ status: 409, json: { code: "conflict", message: "삭제 충돌" } }) : route.fulfill({ status: 204 }); });
  await page.goto(url); await page.getByRole("button", { name: "첫 태그 이름 변경" }).click(); await page.getByRole("textbox", { name: /태그 이름/ }).fill("초안 유지"); await page.getByRole("button", { name: "저장", exact: true }).click();
  await expect(page.getByText(/다른 변경이 저장되었습니다/)).toBeVisible(); await expect(page.getByRole("textbox", { name: /태그 이름/ })).toHaveValue("초안 유지");
  await page.getByRole("button", { name: "취소", exact: true }).click(); await page.getByRole("dialog", { name: "변경을 버릴까요?" }).getByRole("button", { name: "변경 버리기" }).click();
  await page.getByRole("button", { name: "첫 태그 삭제" }).click(); await page.getByRole("dialog", { name: "태그를 삭제할까요?" }).getByRole("button", { name: "삭제", exact: true }).click(); await expect(page.getByText("삭제 충돌")).toBeVisible();
  failedDelete = false; await page.getByRole("button", { name: "첫 태그 삭제" }).click(); await page.getByRole("dialog", { name: "태그를 삭제할까요?" }).getByRole("button", { name: "삭제", exact: true }).click(); await expect(page.getByText("태그를 삭제했습니다.")).toBeVisible();
});
test("엔터티 연결 작성·실패 초안·성공 후 조회 실패와 모달 뒤로가기 보호", async ({ page }) => {
  const entity = { id: "10000000-0000-4000-8000-000000000000", prop1: "문맥 엔터티", prop2: 3, prop3: "2026-10-04", prop4: "b", version: 7, created_at: tags[0].created_at, updated_at: tags[0].updated_at,
    tasks: { count: 0, items: [] }, records: { count: 0, items: [] }, principles: { count: 0, items: [] } };
  let saved = false, failSave = true; const bodies: Record<string, unknown>[] = [];
  await page.route("**/api/entities**", route => route.fulfill(route.request().url().endsWith(entity.id) ? saved ? { status: 503, json: { code: "internal", message: "관련 자료 조회 실패" } } : { json: entity } : { json: { items: [entity], next_cursor: null } }));
  await page.route("**/api/principles**", route => route.fulfill({ json: { items: [], next_cursor: null } }));
  await page.route("**/api/tasks", route => { bodies.push(route.request().postDataJSON()); if (failSave) return route.fulfill({ status: 400, json: { code: "validation", message: "저장 실패" } }); saved = true; return route.fulfill({ status: 201, json: { id: "created" } }); });
  await page.route("**/api/records", route => { bodies.push(route.request().postDataJSON()); return route.fulfill({ status: 201, json: { id: "record-created" } }); });
  await page.goto(url); await page.getByRole("link", { name: "엔터티", exact: true }).click();
  await expect(page.getByText("버전 7")).toHaveCount(0); await page.getByRole("button", { name: "관련 할 일 추가" }).click();
  const form = page.getByRole("dialog", { name: "할 일 추가", exact: true });
  await expect(form.getByLabel("엔터티", { exact: true })).toHaveValue(entity.id);
  await form.getByLabel("제목").fill("연결된 초안"); await form.getByLabel("요약").fill("문맥 유지");
  await page.goBack(); const confirm = page.getByRole("dialog", { name: "변경을 버릴까요?" }); await expect(confirm).toBeVisible(); await confirm.getByRole("button", { name: "취소", exact: true }).click();
  await expect(form.getByLabel("제목")).toHaveValue("연결된 초안");
  await form.getByRole("button", { name: "추가", exact: true }).click(); await expect(form.getByText("저장 실패", { exact: true })).toBeVisible();
  await expect(form.getByLabel("제목")).toHaveValue("연결된 초안"); failSave = false; await form.getByRole("button", { name: "추가", exact: true }).click();
  await expect(form).not.toBeVisible(); await expect(page.getByText("할 일을 추가했습니다.")).toBeVisible(); await expect(page.getByText("관련 자료 조회 실패")).toBeVisible();
  expect(bodies[1].entity_id).toBe(entity.id); await expect(page.getByRole("heading", { name: entity.prop1 })).toBeVisible();
  await page.getByRole("button", { name: "기록 작성", exact: true }).click();
  const record = page.getByRole("dialog", { name: "기록 작성", exact: true }); await expect(record.getByLabel("엔터티", { exact: true })).toHaveValue(entity.id);
  await record.getByLabel("제목").fill("기록 초안"); await record.getByRole("button", { name: "취소", exact: true }).click();
  await page.getByRole("dialog", { name: "변경을 버릴까요?" }).getByRole("button", { name: "취소", exact: true }).click(); await expect(record.getByLabel("제목")).toHaveValue("기록 초안");
  await record.getByRole("button", { name: "취소", exact: true }).click(); await page.getByRole("dialog", { name: "변경을 버릴까요?" }).getByRole("button", { name: "변경 버리기" }).click();
  await expect(page.getByRole("button", { name: "기록 작성", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "기록 작성", exact: true }).click();
  await record.getByLabel("제목").fill("연결 기록"); await record.getByLabel("요약").fill("엔터티 문맥"); await record.getByRole("button", { name: "저장", exact: true }).click();
  await expect(page.getByText("기록을 저장했습니다.")).toBeVisible(); expect(bodies.at(-1)?.entity_id).toBe(entity.id);
});

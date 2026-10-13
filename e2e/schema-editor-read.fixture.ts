import { expect, test } from "@playwright/test";
import type { EntitySchemaChange, SchemaEdit } from "../supabase/functions/_shared/contracts/entity-schema-change.ts";
import { initialEntityDefinition } from "../supabase/functions/_shared/contracts/entity-type.ts";
const base = "/api/entity-types/00000000-0000-4000-8000-000000000001/schema-changes";
function plan(id: string): EntitySchemaChange {
  const target = initialEntityDefinition(id === "a" ? "이전 이름" : "현재 이름");
  return {
    id,
    type_id: "00000000-0000-4000-8000-000000000001",
    version: 1,
    status: "draft",
    change_kind: "compatible",
    target,
    migration: { rules: [], overrides: [] },
    reservations: {},
    diff: [],
    analysis: null,
    source_type_version: 1,
    source_schema_version: 1,
    source_template_fingerprint: "fixture-template",
    edits: [],
    executable: true,
    fingerprint: "fixture-definition",
    created_at: "2026-10-12T00:00:00Z",
    updated_at: "2026-10-12T00:00:00Z",
  };
}
test.beforeEach(async ({ page, baseURL }) => {
  await page.route("**/*", async (route) => {
    if (new URL(route.request().url()).origin === new URL(baseURL!).origin) return route.continue();
    if (new URL(route.request().url()).pathname === base) {
      return route.fulfill({ json: { items: [plan("a"), plan("b")] } });
    }
    return route.fulfill({ json: { items: [] } });
  });
});
test("늦은 이전 변경안 응답은 현재 변경안과 새 입력을 덮지 않는다", async ({ page }) => {
  let finish!: () => void, started!: () => void, delivered!: () => void;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const reading = new Promise<void>((resolve) => {
    started = resolve;
  });
  const sent = new Promise<void>((resolve) => {
    delivered = resolve;
  });
  await page.route(`**${base}/a`, async (route) => {
    started();
    await pending;
    await route.fulfill({ json: plan("a") }).catch(() => {});
    delivered();
  });
  await page.route(`**${base}/b`, (route) => route.fulfill({ json: plan("b") }));
  await page.goto("/e2e/fixtures/schema-editor-read.html?change_id=a");
  await reading;
  await page.getByRole("link", { name: "변경안 B", exact: true }).click();
  await page.getByRole("button", { name: "현재 이름 속성 편집", exact: true }).evaluate((button) => {
    if (button.getAttribute("aria-expanded") === "false") (button as HTMLButtonElement).click();
  });
  await expect(page.getByLabel("속성 이름", { exact: true })).toHaveValue("현재 이름");
  await page.getByLabel("속성 이름", { exact: true }).fill("사용자 초안");
  await page.getByLabel("최대 길이", { exact: true }).fill("12.");
  finish();
  await sent;
  await expect(page.getByLabel("속성 이름", { exact: true })).toHaveValue("사용자 초안");
  await expect(page.getByLabel("최대 길이", { exact: true })).toHaveValue("12.");
  await expect(page.getByRole("link", { name: "이 변경안 직접 링크" })).toHaveAttribute(
    "href",
    "/e2e/fixtures/schema-editor-read.html?change_id=b",
  );
});

test("조회 실패는 현재 변경안을 유지하고 목록 재선택과 편집 취소가 숫자 기준값을 복원한다", async ({ page }) => {
  let failed = true;
  await page.route(
    `**${base}/a`,
    (route) =>
      route.fulfill(
        failed ? { status: 400, json: { code: "invalid", message: "변경안 조회 실패" } } : { json: plan("a") },
      ),
  );
  await page.route(`**${base}/b`, (route) => route.fulfill({ json: plan("b") }));
  await page.goto("/e2e/fixtures/schema-editor-read.html?change_id=b");
  await page.getByRole("button", { name: "현재 이름 속성 편집", exact: true }).evaluate((button) => {
    if (button.getAttribute("aria-expanded") === "false") (button as HTMLButtonElement).click();
  });
  await expect(page.getByLabel("속성 이름", { exact: true })).toHaveValue("현재 이름");
  await page.getByRole("link", { name: "변경안 A", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("변경안 조회 실패");
  await page.getByRole("button", { name: "현재 이름 속성 편집", exact: true }).evaluate((button) => {
    if (button.getAttribute("aria-expanded") === "false") (button as HTMLButtonElement).click();
  });
  await expect(page.getByLabel("속성 이름", { exact: true })).toHaveValue("현재 이름");
  await page.getByLabel("최대 길이", { exact: true }).fill("7.");
  await page.getByRole("link", { name: "변경안 B", exact: true }).click();
  await expect(page.getByLabel("최대 길이", { exact: true })).toHaveValue("7.");
  await page.getByRole("button", { name: "편집 취소", exact: true }).click();
  await expect(page.getByLabel("최대 길이", { exact: true })).toHaveValue("4096");
  await expect(page.getByRole("button", { name: "속성 변경 검토", exact: true })).toBeDisabled();
  failed = false;
  await page.getByText("저장한 변경 초안", { exact: true }).click();
  await page.getByRole("button", { name: "초안 a · 초안", exact: true }).click();
  await expect(page.getByLabel("속성 이름", { exact: true })).toHaveValue("이전 이름");
  await expect(page.getByRole("button", { name: "속성 변경 검토", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "새 변경 시작", exact: true }).click();
  await expect(page.getByLabel("속성 이름", { exact: true })).toHaveValue("이름");
});
test("결과 불명 저장은 동일 요청을 확인하고 발급된 속성 키를 다음 편집에도 유지한다", async ({ page }) => {
  const requests: Array<{ body: { edits: SchemaEdit[] }; method: string; path: string; key: string | undefined }> = [];
  await page.route(`**${base}**`, async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: { items: [] } });
    const body = route.request().postDataJSON() as { edits: SchemaEdit[] };
    requests.push({
      body,
      method: route.request().method(),
      path: new URL(route.request().url()).pathname,
      key: route.request().headers()["idempotency-key"],
    });
    if (requests.length === 1) return route.abort("failed");
    const value = plan("b"), addition = body.edits.find((edit) => edit.op === "add_property");
    if (!addition) throw new Error("Expected new property in the public save request");
    value.target.schema.properties.prop_2 = addition.field;
    value.target.display.order.push("prop_2");
    value.reservations = { [addition.client_ref]: "prop_2" };
    return route.fulfill({ json: value });
  });
  await page.goto("/e2e/fixtures/schema-editor-read.html");
  await page.getByRole("button", { name: "속성 추가", exact: true }).click();
  await page.getByRole("region", { name: "새 속성 속성", exact: true }).getByLabel("속성 이름").fill("추가값");
  await page.getByRole("button", { name: "속성 변경 검토", exact: true }).click();
  await expect(page.getByRole("button", { name: "같은 요청 다시 확인", exact: true })).toBeEnabled();
  await expect(page.getByLabel("속성 이름", { exact: true }).last()).toBeDisabled();
  await page.getByRole("button", { name: "같은 요청 다시 확인", exact: true }).click();
  await page.getByRole("region", { name: "추가값 속성", exact: true }).getByText("기술 정보", { exact: true }).click();
  await expect(page.getByRole("region", { name: "추가값 속성", exact: true })).toContainText("prop_2");
  expect(requests[1]).toEqual(requests[0]);
  expect(requests[0].key).toBeTruthy();
  await expect(page.getByRole("button", { name: "속성 변경 검토", exact: true })).toBeDisabled();
  await page.getByRole("region", { name: "추가값 속성", exact: true }).getByLabel("속성 이름").fill("수정값");
  await page.getByRole("button", { name: "속성 변경 검토", exact: true }).click();
  await expect(page.getByRole("region", { name: "수정값 속성", exact: true })).toContainText("prop_2");
  await expect.poll(() => requests.length).toBe(3);
  await expect(page.getByRole("button", { name: "속성 변경 검토", exact: true })).toBeDisabled();
  expect(requests[2].body.edits.find((edit) => edit.op === "add_property")?.client_ref)
    .toBe(requests[0].body.edits.find((edit) => edit.op === "add_property")?.client_ref);
});
test("복구안 직접 링크는 원본 기준을 적용하며 속성과 변환 규칙을 읽기 전용으로 유지한다", async ({ page }) => {
  await page.route(`**${base}/b`, (route) =>
    route.fulfill({
      json: {
        ...plan("b"),
        recovery: { source_job_id: "source-job", source_expires_at: "2026-11-12T00:00:00Z" },
      },
    }));
  await page.goto("/e2e/fixtures/schema-editor-read.html?change_id=b");
  await page.getByRole("button", { name: "현재 이름 속성 편집", exact: true }).evaluate((button) => {
    if (button.getAttribute("aria-expanded") === "false") (button as HTMLButtonElement).click();
  });
  await expect(page.getByLabel("속성 이름", { exact: true })).toHaveValue("현재 이름");
  await expect(page.getByLabel("속성 이름", { exact: true })).toBeDisabled();
  await expect(page.getByLabel("속성 이름", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "복구안 원본", exact: true })).toContainText("보존 원본");
  await expect(page.getByRole("button", { name: "변경 초안 저장", exact: true })).toHaveCount(0);
});

test("다른 변경안을 읽는 동안 새로 입력한 변환 규칙은 늦은 조회로 지워지지 않는다", async ({ page }) => {
  let finish!: () => void, started!: () => void, delivered!: () => void;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const reading = new Promise<void>((resolve) => {
    started = resolve;
  });
  const sent = new Promise<void>((resolve) => {
    delivered = resolve;
  });
  await page.route(`**${base}/a`, async (route) => {
    started();
    await pending;
    await route.fulfill({ json: plan("a") }).catch(() => {});
    delivered();
  });
  await page.route(`**${base}/b`, (route) => route.fulfill({ json: plan("b") }));
  await page.goto("/e2e/fixtures/schema-editor-read.html?change_id=b");
  await page.getByRole("button", { name: "현재 이름 속성 편집", exact: true }).evaluate((button) => {
    if (button.getAttribute("aria-expanded") === "false") (button as HTMLButtonElement).click();
  });
  await expect(page.getByLabel("속성 이름", { exact: true })).toHaveValue("현재 이름");
  await page.getByRole("link", { name: "변경안 A", exact: true }).click();
  await reading;
  await page.getByText("값 변환 준비", { exact: true }).click();
  await page.getByRole("checkbox", { name: "누락값 채우기", exact: true }).check();
  await page.getByLabel("보완값", { exact: true }).fill("사용자 보완값");
  finish();
  await sent;
  await expect(page.getByLabel("속성 이름", { exact: true })).toBeEnabled();
  await expect(page.getByLabel("보완값", { exact: true })).toHaveValue("사용자 보완값");
  await page.getByRole("button", { name: "현재 이름 속성 편집", exact: true }).evaluate((button) => {
    if (button.getAttribute("aria-expanded") === "false") (button as HTMLButtonElement).click();
  });
  await expect(page.getByLabel("속성 이름", { exact: true })).toHaveValue("현재 이름");
  await expect(page.getByRole("button", { name: "보완 내용 검토", exact: true })).toBeEnabled();
});

test("속성 요약에서 열린 행의 입력을 검토하고 행 완료와 적용을 구분한다", async ({ page }) => {
  const writes: unknown[] = [];
  await page.route(`**${base}`, (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: { items: [] } });
    const body = route.request().postDataJSON();
    writes.push(body);
    const prepared = plan("b");
    prepared.target = {
      ...prepared.target,
      schema: {
        ...prepared.target.schema,
        properties: { prop_1: body.edits.find((edit: SchemaEdit) => edit.op === "update_property").field },
      },
    };
    prepared.diff = [{
      path: "properties.prop_1.title",
      before: "이름",
      after: "검토할 이름",
      before_present: true,
      after_present: true,
      kind: "compatible",
      reason: "표시 이름 변경",
      next_action: "영향 확인",
    }];
    return route.fulfill({ json: prepared });
  });
  await page.goto("/e2e/fixtures/schema-editor-read.html");
  await expect(page.getByLabel("속성 이름", { exact: true })).toBeHidden();
  await page.getByRole("button", { name: "이름 속성 편집", exact: true }).click();
  await page.getByLabel("속성 이름", { exact: true }).fill("검토할 이름");
  await page.getByRole("button", { name: "속성 변경 검토", exact: true }).click();
  const review = page.getByRole("region", { name: "속성 변경 요약", exact: true });
  await expect(review).toContainText("검토할 이름");
  await expect(review).toContainText("아직 자료와 활성 속성에 적용되지 않았습니다");
  expect(writes).toHaveLength(1);
  await page.getByRole("button", { name: "행 편집 완료", exact: true }).click();
  await expect(page.getByLabel("속성 이름", { exact: true })).toBeHidden();
  await page.getByRole("button", { name: "검토할 이름 속성 편집", exact: true }).click();
  await expect(page.getByLabel("속성 이름", { exact: true })).toHaveValue("검토할 이름");
  expect(writes).toHaveLength(1);
});

test("접힌 속성의 잘못된 조건은 검토에서 해당 행을 열고 입력을 보존한다", async ({ page }) => {
  await page.goto("/e2e/fixtures/schema-editor-read.html");
  await page.getByRole("button", { name: "이름 속성 편집", exact: true }).click();
  await page.getByLabel("최대 길이", { exact: true }).fill("1.5");
  await page.getByRole("button", { name: "이름 속성 편집", exact: true }).click();
  await expect(page.getByLabel("최대 길이", { exact: true })).toBeHidden();
  await page.getByRole("button", { name: "속성 변경 검토", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByLabel("최대 길이", { exact: true })).toHaveValue("1.5");
  await expect(page.getByLabel("최대 길이", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "변경 초안 저장", exact: true })).toHaveCount(0);
  await page.getByLabel("최대 길이", { exact: true }).fill("20");
  await page.getByRole("button", { name: "행 편집 완료", exact: true }).click();
  await expect(page.getByRole("button", { name: "이름 속성 편집", exact: true })).toContainText("미저장");
  await page.evaluate(() => document.documentElement.style.fontSize = "200%");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(
    true,
  );
});

test("서버가 거부한 속성은 검토 실패 뒤 해당 행을 열고 초안을 유지한다", async ({ page }) => {
  await page.route(
    `**${base}`,
    (route) =>
      route.request().method() === "GET" ? route.fulfill({ json: { items: [] } }) : route.fulfill({
        status: 400,
        json: {
          code: "invalid",
          message: "대표 속성 조건을 확인하세요.",
          fields: [{ path: "properties.prop_1", message: "대표 속성 조건을 확인하세요." }],
        },
      }),
  );
  await page.goto("/e2e/fixtures/schema-editor-read.html");
  await page.getByRole("button", { name: "이름 속성 편집", exact: true }).click();
  await page.getByLabel("최소 길이", { exact: true }).fill("2");
  await page.getByRole("button", { name: "행 편집 완료", exact: true }).click();
  await page.getByRole("button", { name: "속성 변경 검토", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("대표 속성 조건");
  await expect(page.getByLabel("최소 길이", { exact: true })).toBeVisible();
  await expect(page.getByLabel("최소 길이", { exact: true })).toHaveValue("2");
});

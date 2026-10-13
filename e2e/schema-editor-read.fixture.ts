import { revealSetting } from "./ui-actions.ts";
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
    if (new URL(route.request().url()).origin === new URL(baseURL!).origin) {
      return route.continue();
    }
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
    if (button.getAttribute("aria-expanded") === "false") {
        (button as HTMLButtonElement).click();
      }
    });
  await expect(page.getByLabel("항목 이름", { exact: true })).toHaveValue(
    "현재 이름",
  );
  await page.getByLabel("항목 이름", { exact: true }).fill("사용자 초안");
  await revealSetting(page.getByLabel("최대 길이", { exact: true }));
  await page.getByLabel("최대 길이", { exact: true }).fill("12.");
  finish();
  await sent;
  await expect(page.getByLabel("항목 이름", { exact: true })).toHaveValue(
    "사용자 초안",
  );
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
    if (button.getAttribute("aria-expanded") === "false") {
        (button as HTMLButtonElement).click();
      }
    });
  await expect(page.getByLabel("항목 이름", { exact: true })).toHaveValue(
    "현재 이름",
  );
  await page.getByRole("link", { name: "변경안 A", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("변경안 조회 실패");
  await page.getByRole("button", { name: "현재 이름 속성 편집", exact: true }).evaluate((button) => {
    if (button.getAttribute("aria-expanded") === "false") {
        (button as HTMLButtonElement).click();
      }
    });
  await expect(page.getByLabel("항목 이름", { exact: true })).toHaveValue(
    "현재 이름",
  );
  await revealSetting(page.getByLabel("최대 길이", { exact: true }));
  await page.getByLabel("최대 길이", { exact: true }).fill("7.");
  await page.getByRole("link", { name: "변경안 B", exact: true }).click();
  await expect(page.getByLabel("최대 길이", { exact: true })).toHaveValue("7.");
  await page.getByRole("button", { name: "변경 취소", exact: true }).click();
  await expect(page.getByLabel("최대 길이", { exact: true })).toHaveValue("4096");
  await expect(page.getByRole("button", { name: "변경 검토", exact: true })).toBeEnabled();
  failed = false;
  await page.getByText(/^저장한 변경안 \(/).click();
  await page.getByRole("button", { name: "초안 a · 초안", exact: true }).click();
  await expect(page.getByLabel("항목 이름", { exact: true })).toHaveValue(
    "이전 이름",
  );
  await expect(page.getByRole("button", { name: "변경 검토", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "새 변경 시작", exact: true })).toHaveCount(0);
});
test("결과 불명 저장은 동일 요청을 확인하고 발급된 속성 키를 다음 편집에도 유지한다", async ({ page }) => {
  let lastSaved = plan("b");
  const requests: Array<{ body: { edits: SchemaEdit[] }; method: string; path: string; key: string | undefined }> = [];
  await page.route(`**${base}**`, async (route) => {
    if (new URL(route.request().url()).pathname.endsWith("/analyze")) {
      return route.fulfill({
        status: 202,
        json: { change_id: "b", analysis_id: "00000000-0000-4000-8000-000000000099", status: "queued" },
      });
    }
    if (route.request().method() === "GET") {
      return route.fulfill({
        json: new URL(route.request().url()).pathname.endsWith("/b") ? lastSaved : { items: [] },
      });
    }
    const body = route.request().postDataJSON() as { edits: SchemaEdit[] };
    requests.push({
      body,
      method: route.request().method(),
      path: new URL(route.request().url()).pathname,
      key: route.request().headers()["idempotency-key"],
    });
    if (requests.length === 1) return route.abort("failed");
    const value = plan("b"), addition = body.edits.find((edit) => edit.op === "add_property");
    if (!addition) {
      throw new Error("Expected new property in the public save request");
    }
    value.target.schema.properties.prop_2 = addition.field;
    value.target.display.order.push("prop_2");
    value.reservations = { [addition.client_ref]: "prop_2" };
    lastSaved = value;
    return route.fulfill({ json: value });
  });
  await page.goto("/e2e/fixtures/schema-editor-read.html");
  await page.getByRole("button", { name: "항목 추가", exact: true }).click();
  await page.getByRole("region", { name: "새 항목 속성", exact: true })
    .getByLabel("항목 이름").fill("추가값");
  await page.getByRole("button", { name: "변경 검토", exact: true }).click();
  await expect(page.getByRole("button", { name: "같은 요청 다시 확인", exact: true })).toBeEnabled();
  await expect(page.getByLabel("항목 이름", { exact: true }).last()).toBeDisabled();
  await page.getByRole("button", { name: "같은 요청 다시 확인", exact: true }).click();
  await page.getByRole("button", { name: "편집으로 돌아가기", exact: true })
    .click();
  await expect(page.getByText("기술 정보", { exact: true })).toHaveCount(0);
  expect(requests[1]).toEqual(requests[0]);
  expect(requests[0].key).toBeTruthy();
  await expect(page.getByRole("button", { name: "변경 검토", exact: true })).toBeEnabled();
  await page.getByRole("region", { name: "추가값 속성", exact: true }).getByLabel("항목 이름").fill("수정값");
  await page.getByRole("button", { name: "변경 검토", exact: true }).click();
  await expect(page.getByRole("region", { name: "수정값 속성", exact: true })).toHaveCount(1);
  await expect.poll(() => requests.length).toBe(3);
  await expect(page.getByRole("button", { name: "변경 검토", exact: true })).toBeEnabled();
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
    if (button.getAttribute("aria-expanded") === "false") {
        (button as HTMLButtonElement).click();
      }
    });
  await expect(page.getByLabel("항목 이름", { exact: true })).toHaveValue(
    "현재 이름",
  );
  await expect(page.getByLabel("항목 이름", { exact: true })).toBeDisabled();
  await expect(page.getByLabel("항목 이름", { exact: true })).toBeVisible();
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
  await page.route(
    `**${base}/b`,
    (route) => route.fulfill({ json: { ...plan("b"), change_kind: "migration_required" } }),
  );
  await page.goto("/e2e/fixtures/schema-editor-read.html?change_id=b");
  await page.getByRole("button", { name: "현재 이름 속성 편집", exact: true }).evaluate((button) => {
    if (button.getAttribute("aria-expanded") === "false") {
        (button as HTMLButtonElement).click();
      }
    });
  await expect(page.getByLabel("항목 이름", { exact: true })).toHaveValue(
    "현재 이름",
  );
  await page.getByRole("link", { name: "변경안 A", exact: true }).click();
  await reading;
  await page.getByRole("checkbox", { name: "누락값 채우기", exact: true }).check();
  await page.getByLabel("보완값", { exact: true }).fill("사용자 보완값");
  finish();
  await sent;
  await expect(page.getByLabel("항목 이름", { exact: true })).toBeEnabled();
  await expect(page.getByLabel("보완값", { exact: true })).toHaveValue("사용자 보완값");
  await page.getByRole("button", { name: "현재 이름 속성 편집", exact: true }).evaluate((button) => {
    if (button.getAttribute("aria-expanded") === "false") {
        (button as HTMLButtonElement).click();
      }
    });
  await expect(page.getByLabel("항목 이름", { exact: true })).toHaveValue(
    "현재 이름",
  );
  await expect(page.getByRole("button", { name: "보완 내용 검토", exact: true })).toBeEnabled();
});

test("속성 요약에서 열린 행의 입력을 검토하고 행 완료와 적용을 구분한다", async ({ page }) => {
  const writes: unknown[] = [];
  await page.route(`**${base}`, (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({ json: { items: [] } });
    }
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
  await expect(page.getByLabel("항목 이름", { exact: true })).toBeHidden();
  await page.getByRole("button", { name: "이름 속성 편집", exact: true }).click();
  await page.getByLabel("항목 이름", { exact: true }).fill("검토할 이름");
  await page.getByRole("button", { name: "변경 검토", exact: true }).click();
  const review = page.getByRole("region", { name: "속성 변경 요약", exact: true });
  await expect(review).toContainText("검토할 이름");
  await expect(review).toContainText("아직 적용되지 않았습니다");
  expect(writes).toHaveLength(1);
  await page.getByRole("button", { name: "편집으로 돌아가기", exact: true })
    .click();
  await page.locator(
    ".schema-field .material-section-toggle[aria-expanded=true]",
  ).click();
  await expect(page.getByLabel("항목 이름", { exact: true })).toBeHidden();
  await page.getByRole("button", { name: "검토할 이름 속성 편집", exact: true }).click();
  await expect(page.getByLabel("항목 이름", { exact: true })).toHaveValue(
    "검토할 이름",
  );
  expect(writes).toHaveLength(1);
});

test("접힌 속성의 잘못된 조건은 검토에서 해당 행을 열고 입력을 보존한다", async ({ page }) => {
  await page.goto("/e2e/fixtures/schema-editor-read.html");
  await page.getByRole("button", { name: "이름 속성 편집", exact: true }).click();
  await revealSetting(page.getByLabel("최대 길이", { exact: true }));
  await page.getByLabel("최대 길이", { exact: true }).fill("1.5");
  await page.locator(
    ".schema-field .material-section-toggle[aria-expanded=true]",
  ).click();
  await expect(page.getByRole("button", {name:"이름 속성 편집",exact:true})).toBeFocused();
  await expect(page.getByLabel("최대 길이", { exact: true })).toBeHidden();
  await page.getByRole("button", { name: "변경 검토", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByLabel("최대 길이", { exact: true })).toHaveValue("1.5");
  await expect(page.getByLabel("최대 길이", { exact: true })).toBeVisible();
  await expect(page.getByLabel("최대 길이", { exact: true })).toBeFocused();
  await expect(page.getByRole("button", { name: "변경 초안 저장", exact: true })).toHaveCount(0);
  await revealSetting(page.getByLabel("최대 길이", { exact: true }));
  await page.getByLabel("최대 길이", { exact: true }).fill("20");
  await page.locator(
    ".schema-field .material-section-toggle[aria-expanded=true]",
  ).click();
  await expect(page.getByRole("button", { name: "이름 속성 편집", exact: true })).toContainText("변경됨");
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
  await revealSetting(page.getByLabel("최소 길이", { exact: true }));
  await page.getByLabel("최소 길이", { exact: true }).fill("2");
  await page.locator(
    ".schema-field .material-section-toggle[aria-expanded=true]",
  ).click();
  await page.getByRole("button", { name: "변경 검토", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("대표 속성 조건");
  await expect(page.getByLabel("최소 길이", { exact: true })).toBeVisible();
  await expect(page.getByLabel("최소 길이", { exact: true })).toHaveValue("2");
});

test("변환 미리보기는 속성 키처럼 생긴 저장 문자열도 원본 그대로 보여 준다", async ({ page }) => {
  const prepared = {
    ...plan("b"),
    change_kind: "migration_required",
    status: "ready",
    analysis: {
      id: "analysis-1",
      status: "succeeded",
      total: 1,
      processed: 1,
      failed: 0,
      changed: 1,
      unchanged: 0,
      removed: 0,
      replacements: 0,
      errors: [],
    },
  };
  await page.route(`**${base}/b`, (route) => route.fulfill({ json: prepared }));
  await page.route(
    `**${base}/b/rows?**`,
    (route) =>
      route.fulfill({
        json: {
          items: [{
            entity_id: "20261013-ABCDEFGH",
            before: { prop_1: "prop_0001" },
            after: { prop_1: "prop_1" },
            after_bytes: 20,
            changed: true,
            removed: 0,
            replacements: 0,
            errors: [],
          }],
          next_after: null,
        },
      }),
  );
  await page.goto("/e2e/fixtures/schema-editor-read.html?change_id=b");
  await expect(page.getByRole("region", { name: "변환 규칙과 영향 미리보기" }).locator("dd")).toHaveText(
    "원본 prop_0001 → 변환 prop_1",
  );
});

test("입력 항목 안에서 대표·목록·순서 변경을 함께 취소하고 버튼도 섹션 안에 둔다", async ({ page }, info) => {
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.method() !== "GET" && request.url().includes("/api/")) writes.push(request.url());
  });
  await page.goto("/e2e/fixtures/schema-editor-read.html?display-example=1");
  const section = page.getByRole("region", { name: "입력 항목",
      exact: true,
    });
  await expect(page.getByRole("region", { name: "화면 표시", exact: true })).toHaveCount(0);
  await expect(section.getByLabel("자료 이름으로 사용할 항목")).toHaveValue("prop_1");
  await section.getByRole("button", { name: "수량 속성 편집", exact: true }).click();
  const quantity = page.getByRole("region", { name: "수량 속성", exact: true });
  await expect(quantity.getByLabel("수량 목록에 표시")).toBeHidden();
  await quantity.getByText("추가 설정", { exact: true }).click();
  await quantity.getByLabel("필수 입력").check();
  await quantity.getByLabel("데이터 타입").selectOption("string");
  await section.getByLabel("자료 이름으로 사용할 항목").selectOption("prop_2");
  await section.getByRole("button", { name: "단위 속성 편집", exact: true }).click();
  const unit = page.getByRole("region", { name: "단위 속성", exact: true });
  await unit.getByText("추가 설정", { exact: true }).click();
  await unit.getByLabel("단위 목록에 표시").uncheck();
  const move = quantity.getByRole("button", { name: "수량 위로", exact: true });
  await move.focus();
  await page.keyboard.press("Enter");
  await expect(quantity.getByRole("button", { name: "수량 아래로", exact: true })).toBeFocused();
  await expect(quantity.getByRole("button", { name: "수량 속성 편집", exact: true })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect(section.locator(".schema-field").first()).toContainText("수량");
  await section.getByRole("button", { name: "변경 취소", exact: true }).click();
  await expect(section.locator(".schema-field").first()).toContainText("재료명");
  await expect(unit.getByLabel("단위 목록에 표시")).toBeChecked();
  await expect(quantity.getByLabel("필수 입력")).not.toBeChecked();
  await expect(quantity.getByLabel("데이터 타입")).toHaveValue("number");
  await expect(section.getByLabel("자료 이름으로 사용할 항목")).toHaveValue("prop_1");
  await expect(section.getByRole("button", { name: "변경 검토", exact: true })).toBeDisabled();
  expect(writes).toEqual([]);
  await page.screenshot({ path: info.outputPath("integrated-settings.png"), fullPage: true });
  await page.evaluate(() => document.documentElement.style.fontSize = "200%");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(
    true,
  );
});

test("검토는 저장 성공 후 한 번 분석하고 분석 응답 불명은 같은 키로만 재시도한다", async ({ page }) => {
  let saved = plan("b"), failed = true;
  const requests: Array<{ path: string; key: string | undefined; body: unknown }> = [];
  await page.route(`**${base}**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === "GET") {
      return route.fulfill({ json: path === base ? { items: [] } : saved });
    }
    requests.push({ path, key: route.request().headers()["idempotency-key"], body: route.request().postDataJSON() });
    if (path.endsWith("/analyze")) {
      if (failed) {
        failed = false;
        return route.abort();
      }
      return route.fulfill({
        status: 202,
        json: { change_id: "b", analysis_id: "00000000-0000-4000-8000-000000000099", status: "queued" },
      });
    }
    const body = route.request().postDataJSON();
    saved.target.schema.properties.prop_1 = body.edits.find((edit: SchemaEdit) => edit.op === "update_property").field;
    return route.fulfill({ json: saved });
  });
  await page.goto("/e2e/fixtures/schema-editor-read.html");
  expect(requests).toHaveLength(0);
  await page.getByRole("button", { name: "이름 속성 편집", exact: true }).click();
  await page.getByLabel("항목 이름", { exact: true }).fill("검토한 이름");
  await page.getByRole("button", { name: "변경 검토", exact: true }).click();
  await expect(page.getByRole("button", { name: "같은 요청 다시 확인", exact: true })).toBeEnabled();
  expect(requests.map((r) => r.path)).toEqual([base, `${base}/b/analyze`]);
  expect(requests[0].key).not.toBe(requests[1].key);
  await expect(page.getByLabel("항목 이름", { exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "같은 요청 다시 확인", exact: true }).click();
  await expect(page.getByRole("button", { name: "같은 요청 다시 확인", exact: true })).toHaveCount(0);
  expect(requests).toHaveLength(3);
  expect(requests[2]).toEqual(requests[1]);
  await expect(page.getByRole("button", { name: "변경 적용", exact: true })).toHaveCount(0);
});

test("선택 항목 이름은 코드를 바꾸지 않고 미리보기에 반영하며 취소로 복원한다", async ({ page }) => {
  await page.goto("/e2e/fixtures/schema-editor-read.html?display-example=1");
  await page.getByRole("button", { name: "단위 속성 편집", exact: true }).click();
  await page.getByLabel("선택 항목 1", { exact: true }).fill("포대");
  await expect(page.getByLabel("선택 항목 1", { exact: true })).toHaveValue(
    "포대",
  );
  await expect(page.getByText("기술 정보", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "선택 항목 추가", exact: true }).click();
  await expect(page.getByLabel("선택 항목 3", { exact: true })).toHaveValue("option_1");
  await page.getByRole("button", { name: "선택 항목 3 제거", exact: true }).click();
  await expect(page.getByLabel("선택 항목 3", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "변경 취소", exact: true }).click();
  await expect(page.getByLabel("선택 항목 1", { exact: true })).toHaveValue("킬로그램");
});

test("좁은 화면 200% 배율에서도 속성과 표시 조작이 페이지를 가로로 밀지 않는다", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/e2e/fixtures/schema-editor-read.html?display-example=1");
  await page.evaluate(() => document.documentElement.style.zoom = "2");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(
    true,
  );
});

test("새 행의 타입과 필수 설정은 단순하며 삭제 취소와 사용 중지는 초안만 바꾼다", async ({ page }) => {
  let writes = 0;
  page.on("request", (request) => {
    if (request.method() !== "GET" && request.url().includes("/api/")) writes++;
  });
  await page.goto("/e2e/fixtures/schema-editor-read.html?display-example=1");
  await page.getByRole("button", { name: "항목 추가", exact: true }).click();
  const added = page.getByRole("region", { name: "새 항목 속성", exact: true });
  await expect(added.getByLabel("항목 이름")).toBeVisible();
  await added.getByLabel("데이터 타입").selectOption("number");
  await expect(added.getByLabel("필수 입력")).toBeHidden();
  await added.getByText("추가 설정", { exact: true }).click();
  await added.getByLabel("필수 입력").check();
  await expect(page.getByText("기술 정보", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("값 없음 허용", { exact: false })).toHaveCount(
    0,
  );
  await added.getByRole("button", { name: "항목 삭제", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "항목을 삭제할까요?" });
  await expect(dialog).toContainText("아직 실제 자료는 변경되지 않습니다");
  await dialog.getByRole("button", { name: "취소", exact: true }).click();
  await expect(added.getByLabel("데이터 타입")).toHaveValue("number");
  await added.getByRole("button", { name: "항목 삭제", exact: true }).click();
  await dialog.getByRole("button", { name: "삭제 변경안 만들기", exact: true })
    .click();
  await expect(added).toHaveCount(0);
  await page.getByRole("button", { name: "수량 속성 편집", exact: true })
    .click();
  const quantity = page.getByRole("region", { name: "수량 속성", exact: true });
  await quantity.getByText("추가 설정", { exact: true }).click();
  await quantity.getByLabel("필수 입력").check();
  await quantity.getByRole("button", { name: "사용 중지", exact: true })
    .click();
  await expect(quantity.getByLabel("필수 입력")).not.toBeChecked();
  await expect(quantity.getByRole("button", { name: "다시 사용", exact: true }))
    .toBeEnabled();
  await expect(page.getByLabel("수량 목록에 표시", { exact: true })).not
    .toBeChecked();
  await expect(page.getByLabel("수량 목록에 표시", { exact: true }))
    .toBeDisabled();
  expect(writes).toBe(0);
  await page.getByRole("button", { name: "변경 취소", exact: true }).click();
  await expect(quantity.getByRole("button", { name: "사용 중지", exact: true }))
    .toBeVisible();
  await expect(page.getByLabel("수량 목록에 표시", { exact: true }))
    .toBeChecked();
});

test("자료 폼에서 빈 선택 값은 하나로 표시하고 null·0·false와 이전 정의를 보존한다", async ({ page }) => {
  await page.goto("/e2e/fixtures/schema-editor-read.html?empty-inputs=1");
  const result = page.getByLabel("입력 결과", { exact: true });
  await expect(result).toContainText('"prop_2":"0"');
  await expect(result).toContainText('"prop_3":false');
  await page.getByLabel("숫자 입력", { exact: true }).fill("");
  await expect(result).toContainText('"prop_2":null');
  await page.getByLabel("참거짓 입력", { exact: true }).selectOption("unset");
  await expect(result).toContainText('"prop_3":null');
  await page.getByLabel("선택 입력", { exact: true }).selectOption("unset");
  await expect(result).toContainText('"prop_4":null');
  await expect(page.getByLabel("선택 입력").getByRole("option", { name: "미입력", exact: true })).toHaveCount(1);
  await expect(page.getByRole("option", { name: "값 없음", exact: true })).toHaveCount(0);
  await page.getByLabel("이전 텍스트", { exact: true }).fill("");
  await expect(result).not.toContainText('"prop_5"');
  await page.getByLabel("이전 선택", { exact: true }).selectOption("unset");
  await expect(result).not.toContainText('"prop_6"');
  await page.getByLabel("숫자 입력", { exact: true }).fill("0");
  await page.getByLabel("참거짓 입력", { exact: true }).selectOption("value:false");
  await expect(result).toContainText('"prop_2":"0"');
  await expect(result).toContainText('"prop_3":false');
});

for (const failed of [false, true]) {
  test(`검토 화면은 두 행동만 제공하고 ${failed ? "작업 실패는 동일 요청으로 재시도한다" : "성공은 명시 적용을 기다린다"}`, async ({ page }) => {
    const value = plan("b");
    value.status = failed ? "draft" : "ready";
    value.analysis = {
      id: "00000000-0000-4000-8000-000000000099",
      change_version: 1,
      status: failed ? "failed" : "succeeded",
      total: 24,
      processed: failed ? 0 : 24,
      failed: 0,
      changed: 0,
      unchanged: failed ? 0 : 24,
      removed: 0,
      replacements: 0,
      snapshot_fingerprint: "fixture",
      definition_fingerprint: "fixture",
      retryable: failed,
      failure_reason: failed ? "시험용 작업 실패" : null,
      errors: [],
      created_at: "2026-10-13T00:00:00Z",
    };
    const requests: Array<{ key: string | undefined; body: unknown; path: string }> = [];
    await page.route(`**${base}**`, async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (route.request().method() === "GET") return route.fulfill({ json: path === base ? { items: [] } : value });
      requests.push({ path, body: route.request().postDataJSON(), key: route.request().headers()["idempotency-key"] });
      if (requests.length === 1) return route.abort();
      value.status = "analyzing";
      value.analysis!.status = "queued";
      return route.fulfill({
        status: 202,
        json: {
          type_id: value.type_id,
          change_id: value.id,
          change_version: 1,
          analysis_id: value.analysis!.id,
          status: "queued",
        },
      });
    });
    await page.goto("/e2e/fixtures/schema-editor-read.html?change_id=b");
    const review = page.getByRole("region", { name: "속성 변경 요약", exact: true });
    await expect(review.locator(".schema-actions > button")).toHaveText(
      ["편집으로 돌아가기", failed ? "검토 재시도" : "변경 적용"],
    );
    await expect(page.getByRole("button", { name: "다시 검토", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "새 변경 시작", exact: true })).toHaveCount(0);
    await expect(page.getByText("값 변환 준비", { exact: true })).toHaveCount(0);
    expect(requests).toEqual([]);
    if (!failed) {
      await expect(review.getByRole("button", { name: "변경 적용", exact: true })).toBeEnabled();
      await review.getByRole("button", { name: "편집으로 돌아가기", exact: true }).click();
      await expect(page.getByRole("button", { name: "입력 항목",
      exact: true,
    })).toHaveAttribute(
        "aria-expanded",
        "true",
      );
    } else {
      await review.getByRole("button", { name: "검토 재시도", exact: true }).click();
      await review.getByRole("button", { name: "같은 요청 다시 확인", exact: true }).click();
      await expect(review.getByRole("button", { name: "검토 중…", exact: true })).toBeDisabled();
      expect(requests).toHaveLength(2);
      expect(requests[1]).toEqual(requests[0]);
      expect(requests[0].path).toBe(`${base}/b/analyze`);
    }
  });
}

test("취소한 변경안에서는 항목 편집으로 현재 설정을 열고 직접 링크 선택을 해제한다", async ({ page }) => {
  await page.route(`**${base}/b`, (route) => route.fulfill({ json: { ...plan("b"), status: "cancelled" } }));
  await page.goto("/e2e/fixtures/schema-editor-read.html?change_id=b");
  const review = page.getByRole("region", { name: "속성 변경 요약", exact: true });
  await expect(review.locator(".schema-actions > button")).toHaveText(["항목 편집"]);
  await review.getByRole("button", { name: "항목 편집", exact: true }).click();
  await expect.poll(() => new URL(page.url()).searchParams.has("change_id")).toBe(false);
  await page.getByRole("button", { name: "이름 속성 편집", exact: true }).click();
  await expect(page.getByLabel("항목 이름", { exact: true })).toHaveValue(
    "이름",
  );
});

import { expect, test, type Page } from "@playwright/test";
import { initialEntityDefinition } from "../supabase/functions/_shared/contracts/entity-type.ts";
import { encodeIdentifierReference } from "../supabase/functions/_shared/contracts/entity-identifiers.ts";
import { fixtureWorkspacePath, fulfillFixtureWorkspace } from "./support/workspace-scope.ts";

const typeId = "00000000-0000-4000-8000-000000000900";
const automatic = "00000000-0000-4000-8000-000000000001";
const direct = "00000000-0000-4000-8000-000000000002";
const stamp = "2026-10-22T00:00:00Z";
async function fixture(page: Page, tombstone = false, existingAutomatic = false) {
  const user = { id: "00000000-0000-4000-8000-000000000100", aud: "authenticated", email: "fixture@example.test", app_metadata: {}, user_metadata: {} };
  await page.addInitScript(user => localStorage.setItem("sb-127-auth-token", JSON.stringify({ access_token: "fixture", refresh_token: "fixture", expires_at: Math.floor(Date.now() / 1000) + 3600, user })), user);
  const type = { id: typeId, label: "상품", icon_id: "box", archived: false, schema_version: 1, next_property_number: 4, created_at: stamp, updated_at: stamp };
  const definition = initialEntityDefinition("상품명", { id: typeId, title: "상품" });
  const selectedKind = tombstone && !existingAutomatic ? direct : automatic;
  definition.schema.properties.prop_2["x-identifier"] = { allowed_kind_ids: [automatic, direct], default_kind_id: selectedKind };
  definition.schema.properties.prop_3 = { type: ["string", "null"], title: "외부 번호", "x-order": 30, "x-identifier": { allowed_kind_ids: [automatic, direct], default_kind_id: automatic } };
  const schema = { ...definition, type_id: typeId, type, schema_version: 1, identifier_kinds: [
    { id: automatic, source: "app", source_label: "앱", label: "자동 번호", active: true, generation: "automatic", version: 1, source_version: 1 },
    { id: direct, source: "seller", source_label: "판매처", label: "상품 번호", active: true, generation: "direct", version: 1, source_version: 1 },
  ] };
  let entity = { id: encodeIdentifierReference(typeId, selectedKind, tombstone ? "001:한글/😀" : "generated-1"), identity_label: "상품 번호", entity_type_id: typeId, type,
    schema_version: 1, current_schema_version: 1, version: 3, title: "보관 상품", properties: { prop_1: "보관 상품", prop_2: tombstone ? `${selectedKind}:001:한글/😀` : `${automatic}:generated-1` },
    deleted_at: tombstone ? stamp : null, tag_ids: [], tasks: { count: 0, items: [] }, records: { count: 0, items: [] }, created_at: stamp, updated_at: stamp };
  const writes: { path: string; body: Record<string, unknown> }[] = [], reads: string[] = [];
  await page.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin === "http://127.0.0.1:55586") return route.continue();
    if (url.pathname === "/auth/v1/user") return route.fulfill({ json: user });
    if (await fulfillFixtureWorkspace(route, [{ target_kind: "entity_type", target_id: typeId, access: "write" }])) return;
    const path = url.pathname.replace(/^\/api/, "");
    if (request.method() === "GET") {
      reads.push(path);
      if (path === "/entity-types") return route.fulfill({ json: { items: [type], next_cursor: null } });
      if (path === `/entity-types/${typeId}/schema`) return route.fulfill({ json: schema });
      if (path === "/entities/lookup") return route.fulfill({ json: tombstone ? entity : null });
      if (path === "/entities") return route.fulfill({ json: { items: [], next_cursor: null } });
      if (path === `/entities/${encodeURIComponent(entity.id)}` || decodeURIComponent(path) === `/entities/${entity.id}`) return route.fulfill({ json: entity });
      if (path === "/tags") return route.fulfill({ json: { items: [], next_cursor: null } });
    }
    if (path === "/records/prepare") return route.fulfill({ json: { change_note: "상품 저장", change_tag_ids: [], missing_tag_ids: [], settings_version: 0, prepared_input: request.postDataJSON().input } });
    if (request.method() === "POST" && (path === "/entities" || path.endsWith("/restore"))) {
      const body = request.postDataJSON();
      writes.push({ path, body });
      entity = { ...entity, ...body, deleted_at: null, properties: { ...entity.properties, ...body.properties }, title: body.properties.prop_1, version: 4 };
      return route.fulfill({ json: entity });
    }
    return route.fulfill({ status: 404, json: { code: "not_found", message: `지원하지 않는 fixture 요청: ${path}` } });
  });
  return { writes, reads, schema, entity };
}

test("type-only writer creates with explicit selected issuance and leaves an optional identifier absent", async ({ page }, info) => {
  const state = await fixture(page);
  await page.goto(fixtureWorkspacePath(`/entities?entity_type_id=${typeId}&create=1`));
  const form = page.getByRole("dialog");
  await form.getByLabel("상품명", { exact: false }).fill("새 상품");
  await expect(form.getByText("저장 시 자동 발급", { exact: true })).toHaveCount(1);
  await expect(form.getByLabel("외부 번호 종류")).toHaveValue("unset");
  if (info.project.name === "identifier-desktop") {
    for (const width of [320, 360, 390, 639, 640, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await expect(form.getByLabel("상품명", { exact: false })).toHaveValue("새 상품");
      await expect(form.getByLabel("외부 번호 종류")).toHaveValue("unset");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath(`identifier-create-${width}.png`), animations: "disabled" });
    }
  }
  await form.getByRole("button", { name: "저장", exact: true }).click();
  await page.getByRole("button", { name: "등록하고 저장", exact: true }).click();
  await expect.poll(() => state.writes.length).toBe(1);
  expect(state.writes[0]).toMatchObject({ path: "/entities", body: { generate_identifiers: { prop_2: automatic }, properties: { prop_1: "새 상품" } } });
  expect(state.writes[0].body.properties).not.toHaveProperty("prop_3");
  expect(state.reads.some(path => path.endsWith("/identity") || path.includes("entity-issuers"))).toBe(false);
});

for (const generation of ["direct", "automatic"]) test(`${generation} identity lookup restores only the server returned key and version with the archived values`, async ({ page }) => {
  const state = await fixture(page, true, generation === "automatic");
  await page.goto(fixtureWorkspacePath(`/entities?entity_type_id=${typeId}&create=1`));
  const form = page.getByRole("dialog");
  if (generation === "automatic") await form.getByRole("button", { name: "기존 번호 입력", exact: true }).click();
  await form.getByRole("textbox", { name: /^식별자/ }).fill("001:한글/😀");
  await form.getByRole("button", { name: "기존 대상 확인" }).click();
  await expect(form.getByText("보관한 자료를 불러왔습니다.", { exact: false })).toBeVisible();
  await expect(form.getByLabel("상품명", { exact: false })).toHaveValue("보관 상품");
  await expect(form.getByRole("textbox", { name: /^식별자/ })).toHaveCount(0);
  await form.getByRole("button", { name: "저장", exact: true }).click();
  await page.getByRole("button", { name: "복원하고 저장", exact: true }).click();
  await expect.poll(() => state.writes.length).toBe(1);
  expect(decodeURIComponent(state.writes[0].path)).toBe(`/entities/${state.entity.id}/restore`);
  expect(state.writes[0].body).toMatchObject({ expected_version: 3, properties: state.entity.properties });
  expect(state.writes[0].body).not.toHaveProperty("generate_identifiers");
});

test("a failed identity lookup stays a failure and preserves the raw draft", async ({ page }) => {
  const state = await fixture(page, true);
  await page.route("**/api/entities/lookup?**", route => route.fulfill({ status: 404, json: { code: "not_found", message: "현재 자료 종류를 읽지 못했습니다" } }));
  await page.goto(fixtureWorkspacePath(`/entities?entity_type_id=${typeId}&create=1`));
  const form = page.getByRole("dialog");
  await form.getByRole("textbox", { name: /^식별자/ }).fill("001:한글/😀");
  await form.getByRole("button", { name: "기존 대상 확인" }).click();
  await expect(form.getByText("현재 자료 종류를 읽지 못했습니다", { exact: true })).toBeVisible();
  await expect(form.getByRole("textbox", { name: /^식별자/ })).toHaveValue("001:한글/😀");
  expect(state.writes).toEqual([]);
});

import { executionDialog, openDialogs, shortDialog } from "./ui-actions.ts";
import { expect, test } from "@playwright/test";
import { installWorkspaceApi } from "./support/workspace-api.ts";
import { entity, fixtureType, id } from "./support/workspace-data.ts";
import type { EntityRelationDefinition } from "../supabase/functions/_shared/contracts/entity-relation.ts";
test(
  "create related material in same panel: fixed type, cancel, replacement and exact uncertain retry",
  async ({ page }, info) => {
    const origin = entity(1, { prop_1: "주문 A" }),
      old = entity(2, { prop_1: "기존 품목" });
    const state = await installWorkspaceApi(page, "http://127.0.0.1:56906", {
      entities: [origin, old],
      tasks: [],
      records: [],
      tags: [],
    });
    const definition: EntityRelationDefinition = {
      id: id(700),
      version: 1,
      archived: false,
      ends: [
        { type_id: fixtureType.id, label: "주문품목", cardinality: "one" },
        { type_id: fixtureType.id, label: "소속 주문", cardinality: "many" },
      ],
    };
    const user = {
      id: id(999),
      aud: "authenticated",
      email: "fixture@example.test",
      app_metadata: {},
      user_metadata: {},
    };
    await page.addInitScript(
      (user) =>
        localStorage.setItem(
          "sb-127-auth-token",
          JSON.stringify({
            access_token: "fixture",
            refresh_token: "fixture",
            expires_at: Math.floor(Date.now() / 1000) + 3600,
            user,
          }),
        ),
      user,
    );
    await page.route("**/auth/v1/user", (r) => r.fulfill({ json: user }));
    await page.route(
      "**/api/entity-relation-definitions**",
      (r) => r.fulfill({ json: { items: [definition], next_cursor: null } }),
    );
    let selected = old, lost = true;
    const writes: { body: any; key: string | undefined }[] = [],
      receipts = new Map<string, unknown>();
    let standalone = 0;
    await page.route("**/api/entities", async (r) => {
      if (r.request().method() === "POST") standalone++;
      await r.fallback();
    });
    await page.route("**/api/entity-relations/**", async (r) => {
      const req = r.request(),
        url = new URL(req.url()),
        side = Number(url.pathname.split("/")[4]);
      if (req.method() === "GET") {
        return r.fulfill({
          json: {
            definition,
            side,
            origin_id: origin.id,
            items: side === 0 ? [selected] : [],
            next_cursor: null,
          },
        });
      }
      const body = req.postDataJSON(), key = req.headers()["idempotency-key"];
      writes.push({ body, key });
      if (receipts.has(key!)) return r.fulfill({ json: receipts.get(key!) });
      selected = { ...entity(3, body.entity.properties), version: 2 };
      state.rows.entities.push(selected);
      state.rows.entities.find((e) => e.id === origin.id)!.version = 2;
      const result = {
        entity: selected,
        relation: {
          changed: true,
          definition_id: definition.id,
          side: 0,
          origin_id: origin.id,
          other_id: selected.id,
          endpoint_versions: [{ id: origin.id, version: 2 }, {
            id: selected.id,
            version: 2,
          }],
        },
      };
      receipts.set(key!, result);
      if (lost) {
        lost = false;
        return r.abort("failed");
      }
      return r.fulfill({ json: result });
    });
    await page.goto(`/entities/${encodeURIComponent(origin.id)}`);
    const section = page.getByLabel("주문품목 관계", { exact: true }).filter({
      visible: true,
    });
    await section.getByRole("button", {
      name: "주문품목 작성해서 연결",
      exact: true,
    }).click();
    await expect(page.getByText("작성 후 연결", { exact: true })).toBeVisible();
    await expect(
      openDialogs(page).getByRole("combobox", {
        name: "자료 종류",
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(page.getByText("기존 연결: 기존 품목", { exact: false }))
      .toBeVisible();
    await page.getByRole("textbox", { name: "제목 (필수)", exact: true }).fill(
      "취소할 품목",
    );
    if (info.project.name === "desktop") {
      await page.getByRole("navigation", { name: "주 메뉴" }).getByRole(
        "link",
        { name: "할 일", exact: true },
      ).click();
      await expect(page).toHaveURL(/\/tasks/);
      await page.goBack();
      await expect(
        page.getByRole("textbox", { name: "제목 (필수)", exact: true }),
      ).toHaveValue("취소할 품목");
    }
    await page.getByRole("button", { name: "취소", exact: true }).last()
      .click();
    const discard = shortDialog(page);
    await discard.getByRole("button", { name: /버리|나가기|취소하고/ }).click();
    await expect(section.getByRole("link", { name: "기존 품목", exact: true }))
      .toBeVisible();
    expect(writes).toHaveLength(0);
    await section.getByRole("button", {
      name: "주문품목 작성해서 연결",
      exact: true,
    }).click();
    await page.getByRole("textbox", { name: "제목 (필수)", exact: true }).fill(
      "새 품목",
    );
    await page.screenshot({
      path: `/private/tmp/create-and-link-form-${info.project.name}.png`,
      fullPage: true,
    });
    await page.getByRole("button", { name: "작성하고 연결", exact: true })
      .click();
    await page.getByRole("button", { name: "등록하고 저장", exact: true })
      .click();
    await expect(
      executionDialog(page).getByRole("button", {
        name: "같은 내용 다시 시도",
        exact: true,
      }),
    ).toBeVisible();
    await executionDialog(page).getByRole("button", {
      name: "같은 내용 다시 시도",
      exact: true,
    }).click();
    await expect(section.getByRole("link", { name: "새 품목", exact: true }))
      .toBeVisible();
    expect(writes).toHaveLength(2);
    expect(writes[0]).toEqual(writes[1]);
    expect(writes[0].body.previous_other_id).toBe(old.id);
    expect(writes[0].body.entity.entity_type_id).toBe(fixtureType.id);
    expect(standalone).toBe(0);
    await expect(
      section.getByRole("button", {
        name: "주문품목 작성해서 연결",
        exact: true,
      }),
    ).toBeFocused();
    expect(
      await page.evaluate(() =>
        document.documentElement.scrollWidth <= innerWidth
      ),
    ).toBe(true);
    await page.screenshot({
      path: `/private/tmp/create-and-link-saved-${info.project.name}.png`,
      fullPage: true,
    });
    expect(state.errors).toEqual([]);
  },
);

test("business relation reader sees linked preview without settings or mutation controls", async ({ page }, info) => {
  const origin = entity(21, { prop_1: "읽기 원점" }), peer = entity(22, { prop_1: "읽을 상대" });
  const { fixtureWorkspaceId } = await import("./support/workspace-scope.ts");
  await installWorkspaceApi(page, "http://127.0.0.1:56906", { entities: [origin, peer], tasks: [], records: [], tags: [] });
  const user = { id: id(999), aud: "authenticated", app_metadata: {}, user_metadata: {} };
  await page.addInitScript(user => localStorage.setItem("sb-127-auth-token", JSON.stringify({ access_token: "fixture", refresh_token: "fixture", expires_at: Math.floor(Date.now() / 1000) + 3600, user })), user);
  await page.route("**/auth/v1/user", route => route.fulfill({ json: user }));
  await page.route(`**/api/workspaces/${fixtureWorkspaceId}`, route => route.fulfill({ json: { workspace: { id: fixtureWorkspaceId, name: "업무 읽기 공간", deleted_at: null }, can_manage: false, membership_version: 1, grants: [{ target_kind: "entity_type", target_id: fixtureType.id, access: "read" }] } }));
  const definition: EntityRelationDefinition = { id: id(701), version: 1, archived: false, ends: [{ type_id: fixtureType.id, label: "읽기 연결", cardinality: "one" }, { type_id: fixtureType.id, label: "반대 연결", cardinality: "many" }] };
  await page.route("**/api/entity-relation-definitions**", route => {
    expect(new URL(route.request().url()).searchParams.get("purpose")).toBe("business");
    expect(route.request().headers()["x-workspace-id"]).toBe(fixtureWorkspaceId);
    return route.fulfill({ json: { items: [definition], next_cursor: null } });
  });
  await page.route("**/api/entity-relations/**", route => route.fulfill({ json: { definition, side: 0, origin_id: origin.id, items: [peer], next_cursor: null } }));
  await page.goto(`/w/${fixtureWorkspaceId}/entities/${encodeURIComponent(origin.id)}`);
  const section = page.getByLabel("읽기 연결 관계", { exact: true }).filter({ visible: true });
  await expect(section.getByRole("link", { name: peer.title, exact: true })).toBeVisible();
  await expect(section.getByRole("button", { name: "읽기 연결 작성해서 연결", exact: true })).toHaveCount(0);
  await expect(section.getByRole("button", { name: "변경", exact: true })).toHaveCount(0);
  await expect(section.getByRole("button", { name: "해제", exact: true })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.getAnimations().filter(animation => animation.playState === "running" && animation.effect?.getTiming().iterations !== Infinity).length)).toBe(0);
  await info.attach("business-relation-readonly-preview", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
});

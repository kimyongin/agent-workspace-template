import { businessRows } from "./table-actions.ts";
import { executionDialog } from "./ui-actions.ts";
import { expect, test } from "@playwright/test";
import { installWorkspaceApi } from "./support/workspace-api.ts";
import { entity, fixtureType, id } from "./support/workspace-data.ts";
import type { EntityRelationDefinition } from "../supabase/functions/_shared/contracts/entity-relation.ts";
test(
  "typed detail preserves deleted single value, explicit replacement retry, and loads 101 through more",
  async ({ page }, info) => {
    const origin = entity(1, { prop_1: "원점" }),
      old = { ...entity(2, { prop_1: "삭제된 주문" }), deleted_at: "2026-10-17T00:00:00Z" },
      candidate = entity(3, { prop_1: "새 주문" });
    const many = Array.from(
      { length: 101 },
      (_, n) => entity(20 + n, { prop_1: `재료 ${String(n + 1).padStart(3, "0")}` }),
    );
    const state = await installWorkspaceApi(page, "http://127.0.0.1:56896", {
      entities: [origin, old, candidate, ...many],
      tasks: [],
      records: [],
      tags: [],
    });
    const definitions: EntityRelationDefinition[] = [{
      id: id(700),
      version: 1,
      archived: false,
      ends: [{ type_id: fixtureType.id, label: "소속 주문", cardinality: "one" }, {
        type_id: fixtureType.id,
        label: "주문품목",
        cardinality: "many",
      }],
    }, {
      id: id(701),
      version: 1,
      archived: false,
      ends: [{ type_id: fixtureType.id, label: "구성재료", cardinality: "many" }, {
        type_id: fixtureType.id,
        label: "사용 레시피",
        cardinality: "many",
      }],
    }];
    let selected = old.id;
    let lost = true;
    const writes: { body: any; key: string | undefined }[] = [];
    const receipts = new Map<string, unknown>();
    const user = {
      id: id(999),
      aud: "authenticated",
      email: "fixture@example.test",
      app_metadata: {},
      user_metadata: {},
    };
    await page.addInitScript((user) =>
      localStorage.setItem(
        "sb-127-auth-token",
        JSON.stringify({
          access_token: "fixture",
          refresh_token: "fixture",
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          user,
        }),
      ), user);
    await page.route("**/auth/v1/user", (r) => r.fulfill({ json: user }));
    await page.route("**/api/entity-relation-definitions**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      return route.fulfill({
        json: path.endsWith(id(700)) ? definitions[0] : { items: definitions, next_cursor: null },
      });
    });
    await page.route("**/api/entity-relations/**", async (route) => {
      const req = route.request(),
        url = new URL(req.url()),
        parts = url.pathname.split("/"),
        definition = definitions.find((d) => d.id === parts[3])!,
        side = Number(parts[4]);
      if (req.method() === "POST") {
        const body = req.postDataJSON(), key = req.headers()["idempotency-key"];
        writes.push({ body, key });
        if (key && receipts.has(key)) {
          return route.fulfill({ json: receipts.get(key) });
        }
        const changed = state.rows.entities.find((e) => e.id === origin.id)!;
        changed.version++;
        if (url.pathname.endsWith("/replace")) selected = body.other_id;
        else if (url.pathname.endsWith("/unlink")) selected = "";
        const result = {
          changed: true,
          definition_id: definition.id,
          side,
          origin_id: origin.id,
          other_id: body.other_id,
          endpoint_versions: [{ id: origin.id, version: changed.version }, { id: body.other_id, version: 2 }],
        };
        receipts.set(key!, result);
        if (lost) {
          lost = false;
          return route.abort("failed");
        }
        return route.fulfill({ json: result });
      }
      const items = url.pathname.endsWith("/candidates")
        ? [candidate]
        : side === 0
        ? definition.id === id(700) ? selected ? [state.rows.entities.find((e) => e.id === selected)!] : [] : many
        : [];
      const start = Number(url.searchParams.get("cursor") ?? 0), limit = Number(url.searchParams.get("limit") ?? 20);
      return route.fulfill({
        json: {
          definition,
          side,
          origin_id: origin.id,
          items: items.slice(start, start + limit),
          next_cursor: items.length > start + limit ? String(start + limit) : null,
        },
      });
    });
    await page.goto(`/entities/${encodeURIComponent(origin.id)}`);
    const single = page.getByLabel("소속 주문 관계", { exact: true }).filter({ visible: true }),
      multi = page.getByLabel("구성재료 관계", { exact: true }).filter({ visible: true });
    await expect(single.getByRole("link", { name: "삭제된 주문", exact: true })).toBeVisible();
    await expect(single).toContainText("삭제됨");
    await expect(single.getByRole("button", { name: /목록 보기|카드 보기|표 보기/ })).toHaveCount(0);
    await single.getByRole("button", { name: "변경", exact: true }).click();
    await single.getByLabel("자료 제목 검색", { exact: true }).fill("새 주문");
    await single.getByRole("button", { name: "새 주문 연결", exact: true }).click();
    await page.getByRole("button", { name: "수정하고 저장", exact: true }).click();
    await expect(
      executionDialog(page).getByRole("button", { name: "같은 내용 다시 시도", exact: true }),
    ).toBeVisible();
    await executionDialog(page).getByRole("button", { name: "같은 내용 다시 시도", exact: true })
      .click();
    await expect(single.getByRole("link", { name: "새 주문", exact: true })).toBeVisible();
    expect(writes.length).toBe(2);
    expect(writes[0]).toEqual(writes[1]);
    expect(writes[0].body.previous_other_id).toBe(old.id);
    await single.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `/private/tmp/typed-relations-single-${info.project.name}.png`, fullPage: true });
    for (let n = 0; n < 5; n++) await multi.getByRole("button", { name: "더 보기", exact: true }).click();
    await expect(multi.getByRole("button", { name: "재료 101", exact: true })).toBeVisible();
    await expect(businessRows(multi.getByRole("table"))).toHaveCount(101);
    await page.screenshot({ path: `/private/tmp/typed-relations-${info.project.name}.png`, fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await single.getByRole("button", { name: "해제", exact: true }).click();
    await page.getByRole("button", { name: "해제하고 저장", exact: true }).click();
    await expect(single).toContainText("연결된 자료가 없습니다");
    expect(state.errors).toEqual([]);
  },
);

import { createFixtureEntity, fixtureEntityList, scalarFixtureType } from "./entity-schema-support.ts";
import { expect } from "@playwright/test";
import { devLogin, mcpClient, mcpTokenViaConsent, test, unique } from "./support.ts";
import { savePrinciple } from "./principle-support.ts";
import { openDetailEditor, saveOnce } from "./ui-actions.ts";

for (const model of ["entity", "task", "principle"] as const) {
  for (const stage of ["prepare", "write"] as const) {
    test(`#335 실제 MCP→웹 ${model}: ${stage} 충돌·초안 보존·취소 후 재조회·새 의도 저장`, async ({ page }) => {
      await devLogin(page);
      const mcp = await mcpClient(await mcpTokenViaConsent(page));
      const title = unique(`충돌 ${model}`), latest = `${title} 최신`, draft = `${title} 초안`;
      let target: { id: string; version: number } | undefined;
      let resultId: string | undefined;
      try {
        if (model === "entity") {
          const type = await scalarFixtureType(mcp);
          const identity = await mcp.call("get_entity_type_identity", {
            type_id: type.id,
          });
          target = await createFixtureEntity(
            mcp,
            { prop_1: title, prop_2: 0 },
            {
              source: identity.default_source,
              identity_version: identity.version,
            },
          );
        } else {
          const created = model === "task"
            ? await mcp.call("create_task", { kind: "once", title })
            : await savePrinciple(mcp, { title });
          target = { id: created.id, version: created.version };
        }
        const list = model === "entity" ? "entities" : model === "task" ? "tasks" : "principles";
        const inputLabel = model === "entity" ? "제목" : "제목";
        await page.goto(`/${list}/${encodeURIComponent(target!.id)}`);
        await openDetailEditor(page);
        const editor = page.locator("dialog.modal:not(.modal-confirm)[open]");
        const confirmation = page.locator("dialog.modal-action[open]");
        await editor.getByLabel(inputLabel, { exact: false }).fill(draft);
        if (stage === "write") {
          await editor.getByRole("button", { name: "저장", exact: true }).click();
          await expect(confirmation.getByRole("button", { name: "수정하고 저장", exact: true })).toBeEnabled();
        }
        const updated = await mcp.call(`update_${model}`, {
          id: target!.id,
          expected_version: target!.version,
          ...(model === "entity"
            ? {
              schema_version: (await scalarFixtureType(mcp)).schema_version,
              properties: { prop_1: latest, prop_2: 10 },
            }
            : { title: latest, body: "다른 접점의 최신 본문" }),
          change_note: "실제 MCP 변경과 웹 초안 충돌 검증",
        });
        if (model === "task") {
          const completed = await mcp.call("complete_task", {
            id: target!.id,
            expected_version: updated.version,
            body: "충돌 검증용 완료 결과",
          });
          resultId = completed.record.id;
        }
        if (stage === "prepare") await editor.getByRole("button", { name: "저장", exact: true }).click();
        else await confirmation.getByRole("button", { name: "수정하고 저장", exact: true }).click();
        await expect(confirmation).toContainText("편집을 취소");
        if (stage === "prepare") {
          await expect(confirmation.getByRole("button", { name: "수정하고 저장", exact: true })).toBeDisabled();
        }
        expect((await mcp.call(`get_${model}`, { id: target!.id })).title).toBe(latest);
        await confirmation.getByRole("button", { name: "취소", exact: true }).click();
        await expect(confirmation).toHaveCount(0);
        await expect(editor.getByLabel(inputLabel, { exact: false })).toHaveValue(draft);
        await editor.getByRole("button", { name: "취소", exact: true }).click();
        await page.getByRole("dialog", { name: "변경을 버릴까요?" }).getByRole("button", { name: "변경 버리기" })
          .click();
        await expect(editor.locator(".detail-title")).toHaveText(latest);
        if (model === "task") {
          await expect(editor.getByText("완료", { exact: true })).toBeVisible();
          await expect(editor.getByRole("button", { name: "완료하고 기록", exact: true })).toHaveCount(0);
        }
        await openDetailEditor(page);
        await editor.getByLabel(inputLabel, { exact: false }).fill(`${title} 재검토`);
        await saveOnce(page, editor);
        await expect(editor.getByRole("button", { name: "편집", exact: true })).toBeVisible();
        const saved = await mcp.call(`get_${model}`, { id: target!.id });
        expect(saved.title).toBe(`${title} 재검토`);
      } finally {
        try {
          if (resultId) {
            const record = await mcp.call("get_record", { id: resultId });
            await mcp.call("delete_record", { id: resultId, expected_version: record.version });
          }
          if (target) {
            const current = await mcp.call(`get_${model}`, { id: target.id });
            await mcp.call(`delete_${model}`, {
              id: target.id,
              expected_version: current.version,
              change_note: "충돌 회귀 검증 자료 정리",
            });
          }
        } finally {
          await mcp.close();
        }
      }
    });
  }
}

// Source-authored actual browser scenarios. Root execution and visual review
// supply runtime evidence; authoring/type checking alone does not.
import {
  expect,
  type Page,
  type Response,
  type TestInfo,
} from "@playwright/test";
import {
  devLogin,
  env,
  mcpClient,
  mcpTokenViaConsent,
  ownedWorkspace,
  test,
  workspacePath,
} from "./support.ts";
import {
  chooseTag,
  detailDialog,
  executionDialog,
  openDetailEditor,
  saveOnce,
} from "./ui-actions.ts";

type Inspector = Pick<Awaited<ReturnType<typeof mcpClient>>, "call">;
async function setup(page: Page) {
  await devLogin(page);
  const workspace = await ownedWorkspace(page);
  const client = await mcpClient(await mcpTokenViaConsent(page), {
    workspaceId: workspace.id,
  });
  // Business writes in these scenarios belong to the browser. Only dictionary
  // fixture setup uses the raw scoped client; inspection remains read-only.
  const read: Inspector = {
    call: (name, args) => {
      if (!/^(get_|list_)/.test(name)) {
        throw new Error(
          "Browser activity oracle accepts reads only",
        );
      }
      return client.call(name, args);
    },
  };
  await page.goto(workspacePath(workspace.id, "/tasks"));
  return { workspace, client, read };
}
const titleInput = (page: Page) =>
  detailDialog(page).getByRole("textbox", { name: /^제목(?: \(필수\))?$/ });
const writeBodies = new WeakMap<
  Response,
  Awaited<ReturnType<Response["json"]>>
>();
const writeResponse = (page: Page, method: string, path: string) =>
  page.waitForResponse((response) =>
    response.request().method() === method &&
    new URL(response.url()).pathname ===
      new URL(`${env.VITE_API_URL}${path}`).pathname
  ).then(async (response) => {
    // Read JSON as the response arrives, before a successful write navigates.
    // A 204 is deliberately bodyless; other body/read failures remain failures.
    writeBodies.set(
      response,
      response.status() === 204 ? null : await response.json(),
    );
    return response;
  });
async function scopedWrite(response: Response, workspaceId: string) {
  expect(response.ok()).toBeTruthy();
  expect(response.request().headers()["x-workspace-id"]).toBe(workspaceId);
  expect(response.request().headers()["idempotency-key"]).toMatch(
    /^[0-9a-f-]{36}$/i,
  );
  if (!writeBodies.has(response)) {
    throw new Error("write response was not captured before navigation");
  }
  return writeBodies.get(response);
}
async function createInBrowser(page: Page, workspaceId: string, title: string) {
  await page.getByRole("button", { name: "할 일 등록", exact: true }).click();
  const surface = detailDialog(page);
  await titleInput(page).fill(title);
  await surface.getByLabel("본문", { exact: false }).fill(
    "긴 한국어 본문과 공백없는문자열ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789를 유지합니다.",
  );
  await expect(surface.getByRole("button", { name: "태그 선택", exact: true }))
    .toHaveCount(0);
  const saved = writeResponse(page, "POST", "/tasks");
  await saveOnce(page, surface, "추가");
  const response = await saved;
  expect(response.request().postDataJSON()).not.toHaveProperty("tag_ids");
  const task = await scopedWrite(response, workspaceId);
  await expect(
    detailDialog(page).getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
  return task as { id: string; version: number; tag_ids: string[] };
}
async function snapshot(page: Page, info: TestInfo, name: string) {
  await page.evaluate(() => document.fonts.ready);
  await expect(
    page.getByText(/^(불러오는 중…|공간을 확인하는 중…)$/).filter({
      visible: true,
    }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      document.documentElement.scrollWidth <= window.innerWidth + 1
    ),
    "ordinary page must not overflow horizontally",
  ).toBe(true);
  const surface = detailDialog(page);
  if (await surface.count()) {
    const box = await surface.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(-1);
    expect(box!.x + box!.width).toBeLessThanOrEqual(
      page.viewportSize()!.width + 1,
    );
  }
  const path = info.outputPath(`${name}.png`);
  await page.screenshot({
    path,
    fullPage: true,
    animations: "disabled",
    caret: "hide",
  });
  await info.attach(name, { path, contentType: "image/png" });
}
async function connectTag(page: Page, workspaceId: string, tagName: string) {
  const region = detailDialog(page).getByRole("region", {
    name: "태그 연결",
    exact: true,
  });
  await region.getByRole("button", { name: "태그 연결", exact: true }).click();
  await chooseTag(page, region, tagName);
  const saved = writeResponse(page, "POST", "/tag-connections");
  await saveOnce(page, region, "연결 적용");
  await scopedWrite(await saved, workspaceId);
  await expect(region.getByText(tagName, { exact: true })).toBeVisible();
}

test(
  "actual activity editor: cancel retains draft and focus; saved task tags link and unlink independently",
  async ({ page }, info) => {
    const { workspace, client, read } = await setup(page);
    const tag = await client.call("create_tag", {
      scope: "task",
      name: "검토 필요",
    });
    const task = await createInBrowser(
      page,
      workspace.id,
      "자료 확인과 검토 계획",
    );
    const before = await read.call("get_task", { id: task.id });
    await openDetailEditor(page);
    await titleInput(page).fill("저장 전 제목 초안");
    const save = detailDialog(page).getByRole("button", {
      name: "저장",
      exact: true,
    });
    await save.click();
    await expect(executionDialog(page)).toBeVisible();
    await executionDialog(page).getByLabel("기록 메모", { exact: true }).fill(
      "확인 취소 후에도 남는 메모",
    );
    await snapshot(page, info, "task-edit-confirmation");
    await executionDialog(page).getByRole("button", {
      name: "취소",
      exact: true,
    }).click();
    await expect(titleInput(page)).toHaveValue("저장 전 제목 초안");
    await expect(save).toBeFocused();
    const cancel = detailDialog(page).getByRole("button", {
      name: "취소",
      exact: true,
    });
    await cancel.click();
    const discard = page.getByRole("alertdialog", {
      name: "변경을 버릴까요?",
      exact: true,
    });
    await expect(discard).toBeVisible();
    await discard.getByRole("button", { name: "취소", exact: true }).click();
    await expect(titleInput(page)).toHaveValue("저장 전 제목 초안");
    await expect(cancel).toBeFocused();
    expect(await read.call("get_task", { id: task.id })).toEqual(before);
    const edited = writeResponse(page, "PATCH", `/tasks/${task.id}`);
    await saveOnce(page, detailDialog(page));
    const editResponse = await edited;
    expect(editResponse.request().postDataJSON()).not.toHaveProperty("tag_ids");
    await scopedWrite(editResponse, workspace.id);
    await expect(
      detailDialog(page).getByRole("heading", {
        name: "저장 전 제목 초안",
        exact: true,
      }),
    ).toBeVisible();
    await connectTag(page, workspace.id, tag.name);
    const linked = await read.call("get_task", { id: task.id });
    expect(linked.tag_ids).toEqual([tag.id]);
    expect(linked.title).toBe("저장 전 제목 초안");
    await snapshot(page, info, "task-saved-tag");
    const region = detailDialog(page).getByRole("region", {
      name: "태그 연결",
      exact: true,
    });
    await region.getByRole("button", {
      name: `${tag.name} 연결 해제`,
      exact: true,
    }).click();
    const unlinked = writeResponse(page, "POST", "/tag-connections");
    await saveOnce(page, region, "연결 적용");
    await scopedWrite(await unlinked, workspace.id);
    const after = await read.call("get_task", { id: task.id });
    expect(after.tag_ids).toEqual([]);
    expect(after.body).toBe(before.body);
    expect(after.title).toBe(linked.title);
    await expect(region.getByRole("button", { name: "태그 연결", exact: true }))
      .toBeFocused();
  },
);

test(
  "actual activity result: completion content, immutable parent, soft delete/restore and result edit/delete",
  async ({ page }, info) => {
    const { workspace, client, read } = await setup(page);
    const tag = await client.call("create_tag", {
      scope: "task",
      name: "계획 분류",
    });
    const task = await createInBrowser(
      page,
      workspace.id,
      "현장 점검 결과 보존",
    );
    await connectTag(page, workspace.id, tag.name);
    await detailDialog(page).getByRole("button", {
      name: "완료하고 기록",
      exact: true,
    }).click();
    await detailDialog(page).getByRole("button", { name: "취소", exact: true })
      .click();
    await expect(page).not.toHaveURL(/action=|occurrence=/);
    expect(
      (await read.call("list_records", {
        task_id: task.id,
        record_kind: "result",
      })).items,
    ).toHaveLength(0);
    await detailDialog(page).getByRole("button", {
      name: "완료하고 기록",
      exact: true,
    }).click();
    await detailDialog(page).getByRole("textbox", { name: /^본문/ }).fill(
      "현장 점검을 수행했습니다.",
    );
    await expect(
      detailDialog(page).getByRole("button", {
        name: "태그 선택",
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      detailDialog(page).getByRole("button", {
        name: "자료 연결",
        exact: true,
      }),
    ).toHaveCount(0);
    const completed = writeResponse(page, "POST", `/tasks/${task.id}/complete`);
    await detailDialog(page).getByRole("button", {
      name: "완료하고 기록 저장",
      exact: true,
    }).click();
    const completeResponse = await completed;
    const input = completeResponse.request().postDataJSON();
    for (const key of ["tag_ids", "entity_ids", "entity_id", "task_id"]) {
      expect(input).not.toHaveProperty(key);
    }
    const completion = await scopedWrite(completeResponse, workspace.id);
    const record = completion.record;
    expect(record.task_id).toBe(task.id);
    expect(record.entity_id).toBeNull();
    expect(record.tag_ids).toEqual([]);
    await expect(page).not.toHaveURL(/action=|occurrence=/);
    await expect(
      detailDialog(page).getByRole("heading", {
        name: "현장 점검 결과 보존",
        exact: true,
      }),
    ).toBeVisible();
    await openDetailEditor(page);
    const deleted = writeResponse(page, "POST", `/tasks/${task.id}/delete`);
    await saveOnce(page, detailDialog(page), "삭제");
    await scopedWrite(await deleted, workspace.id);
    const archived = await read.call("get_task", { id: task.id });
    expect(archived.deleted_at).not.toBeNull();
    expect((await read.call("get_record", { id: record.id })).body).toBe(
      record.body,
    );
    await page.goto(workspacePath(workspace.id, `/tasks/${task.id}`));
    await expect(
      detailDialog(page).getByText("삭제된 할 일입니다.", { exact: false }),
    ).toBeVisible();
    for (const name of ["편집", "완료하고 기록", "태그 연결", "자료 연결"]) {
      await expect(
        detailDialog(page).getByRole("button", { name, exact: true }),
      ).toHaveCount(0);
    }
    await snapshot(page, info, "task-soft-deleted");
    await detailDialog(page).getByRole("button", { name: "복원", exact: true })
      .click();
    await expect(executionDialog(page)).toBeVisible();
    await executionDialog(page).getByLabel("기록 메모", { exact: true }).fill(
      "보관된 결과와 함께 복원",
    );
    const restored = writeResponse(page, "POST", `/tasks/${task.id}/restore`);
    await executionDialog(page).getByRole("button", {
      name: "복원하고 저장",
      exact: true,
    }).click();
    const restoreResponse = await restored;
    expect(restoreResponse.request().postDataJSON().expected_version).toBe(
      archived.version,
    );
    const recovered = await scopedWrite(restoreResponse, workspace.id);
    expect(recovered.id).toBe(task.id);
    expect(recovered.deleted_at).toBeNull();
    expect((await read.call("get_task", { id: task.id })).result_record.id)
      .toBe(record.id);
    await page.goto(workspacePath(workspace.id, `/records/${record.id}`));
    await openDetailEditor(page);
    await detailDialog(page).getByRole("textbox", { name: /^본문/ }).fill(
      "현장 점검 후 보완한 결과입니다.",
    );
    const edited = writeResponse(page, "PATCH", `/records/${record.id}`);
    await saveOnce(page, detailDialog(page));
    const recordEdit = await edited;
    for (const key of ["tag_ids", "entity_ids", "entity_id", "task_id"]) {
      expect(recordEdit.request().postDataJSON()).not.toHaveProperty(key);
    }
    await scopedWrite(recordEdit, workspace.id);
    const savedRecord = await read.call("get_record", { id: record.id });
    expect(savedRecord.task_id).toBe(task.id);
    expect(savedRecord.entity_id).toBeNull();
    expect(savedRecord.body).toBe("현장 점검 후 보완한 결과입니다.");
    await snapshot(page, info, "result-edited-fixed-parent");
    await openDetailEditor(page);
    const removed = writeResponse(page, "DELETE", `/records/${record.id}`);
    await saveOnce(page, detailDialog(page), "삭제");
    const removeResponse = await removed;
    expect(removeResponse.ok()).toBeTruthy();
    expect(removeResponse.request().headers()["x-workspace-id"]).toBe(
      workspace.id,
    );
    const finalTask = await read.call("get_task", { id: task.id });
    expect(finalTask.status).toBe("done");
    expect(finalTask.result_record).toBeNull();
    expect(
      (await read.call("list_records", {
        task_id: task.id,
        record_kind: "result",
      })).items,
    ).toHaveLength(0);
  },
);

test(
  "actual activity grants: READ disables and NONE conceals a prepared draft, WRITE restores exact content/version",
  async ({ page }, info) => {
    const { workspace, read } = await setup(page);
    const task = await createInBrowser(
      page,
      workspace.id,
      "권한 변경 중 유지하는 초안",
    );
    const before = await read.call("get_task", { id: task.id });
    await openDetailEditor(page);
    await titleInput(page).fill("권한 복구 뒤 저장할 제목");
    await detailDialog(page).getByLabel("본문", { exact: false }).fill(
      "권한 변경 중에도 유지할 본문 초안",
    );
    await detailDialog(page).getByRole("button", { name: "저장", exact: true })
      .click();
    await expect(executionDialog(page)).toBeVisible();
    await executionDialog(page).getByLabel("기록 메모", { exact: true }).fill(
      "보존할 확인 메모",
    );
    const taskWrites: string[] = [];
    page.on("request", (request) => {
      if (
        new URL(request.url()).pathname.endsWith(`/tasks/${task.id}`) &&
        request.method() === "PATCH"
      ) taskWrites.push(request.postData() ?? "");
    });
    const changeAccess = async (access: "read" | "write" | "none") => {
      await workspace.setTaskAccess(access);
      const refreshed = page.waitForResponse((response) =>
        response.request().method() === "GET" &&
        new URL(response.url()).pathname.endsWith(`/workspaces/${workspace.id}`)
      );
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      expect((await refreshed).ok()).toBeTruthy();
    };
    await changeAccess("read");
    await expect(
      executionDialog(page).getByRole("button", {
        name: "수정하고 저장",
        exact: true,
      }),
    ).toBeDisabled();
    await expect(executionDialog(page).getByLabel("기록 메모", { exact: true }))
      .toHaveValue("보존할 확인 메모");
    await snapshot(page, info, "task-prepared-readonly");
    await changeAccess("none");
    await expect(executionDialog(page)).toHaveCount(0);
    for (
      const text of [
        before.title,
        "권한 복구 뒤 저장할 제목",
        "권한 변경 중에도 유지할 본문 초안",
        "보존할 확인 메모",
      ]
    ) {
      await expect(
        page.getByText(text, { exact: true }).filter({ visible: true }),
      ).toHaveCount(0);
    }
    await expect(page.getByRole("textbox", { name: /^제목/ })).toHaveCount(0);
    expect(taskWrites).toEqual([]);
    await snapshot(page, info, "task-current-none-concealed");
    await changeAccess("read");
    await expect(executionDialog(page)).toBeVisible();
    await expect(
      executionDialog(page).getByRole("button", {
        name: "수정하고 저장",
        exact: true,
      }),
    ).toBeDisabled();
    await changeAccess("write");
    await expect(executionDialog(page).getByLabel("기록 메모", { exact: true }))
      .toHaveValue("보존할 확인 메모");
    await expect(
      executionDialog(page).getByRole("button", {
        name: "수정하고 저장",
        exact: true,
      }),
    ).toBeEnabled();
    const saved = writeResponse(page, "PATCH", `/tasks/${task.id}`);
    await executionDialog(page).getByRole("button", {
      name: "수정하고 저장",
      exact: true,
    }).click();
    const response = await saved;
    const input = response.request().postDataJSON();
    expect(input.expected_version).toBe(before.version);
    expect(input.title).toBe("권한 복구 뒤 저장할 제목");
    expect(input.body).toBe("권한 변경 중에도 유지할 본문 초안");
    expect(input.change_note).toBe("보존할 확인 메모");
    await scopedWrite(response, workspace.id);
    expect(taskWrites).toHaveLength(1);
    const after = await read.call("get_task", { id: task.id });
    expect(after.title).toBe(input.title);
    expect(after.body).toBe(input.body);
    expect(after.version).toBe(before.version + 1);
    await expect(
      detailDialog(page).getByRole("heading", {
        name: after.title,
        exact: true,
      }),
    ).toBeVisible();
    await snapshot(page, info, "task-current-write-restored");
  },
);

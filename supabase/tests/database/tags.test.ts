import { businessWorkspaceFixture } from "./_workspace-business.ts";
import { requestActor } from "../_request.ts";
import { assertEquals, assertRejects } from "@std/assert";
import { SqlTagUnitOfWork } from "../../functions/_shared/adapters/supabase/tag-store.ts";
import { tagCreate, tagListQuery, tagRename } from "../../functions/_shared/contracts/tag.ts";
import { createTag, deleteTag, listTags, renameTag } from "../../functions/_shared/core/tags/application.ts";
import { AppError } from "../../functions/_shared/core/shared/errors.ts";
import { connect, dbTest, urls } from "./_db.ts";
const admin = connect(urls.admin, { max: 1 }), sql = connect(urls.pooler, { max: 3, prepare: false });
const deps = { uow: new SqlTagUnitOfWork(sql) };
dbTest("태그: 대소문자 중복·경쟁·버전·공간 격리·멱등", async () => {
  const fixture = await businessWorkspaceFixture(admin, sql);
  const foreign = await fixture.addWorkspace("다른 태그 공간");
  const A = fixture.manager, B = foreign.manager;
  try {
    const name = "Test" + crypto.randomUUID().slice(0, 20),
      input = tagCreate.parse({ ...{ name } });
    const p = await createTag(deps, requestActor(A), input);
    await assertRejects(() => createTag(deps, requestActor(A), input), AppError);
    await assertRejects(
      () => createTag(deps, requestActor(A), tagCreate.parse({ ...{ name: name.toLowerCase() } })),
      AppError,
    );
    await createTag(deps, requestActor(B), tagCreate.parse({ ...{ name } }));
    await assertRejects(() => deleteTag(deps, requestActor(B), p.id, 1), AppError);
    await createTag(deps, requestActor(A), tagCreate.parse({ name: "페이지 " + crypto.randomUUID().slice(0, 20) }));
    const q = tagListQuery.parse({ limit: 1 }), page = await listTags(deps, A, q);
    assertEquals(typeof page.next_cursor, "string");
    await assertRejects(() => listTags(deps, B, { ...q, cursor: page.next_cursor! }), AppError);
    const renamed = await renameTag(
      deps,
      requestActor(A),
      p.id,
      tagRename.parse({
        name: "정정" + crypto.randomUUID().slice(0, 20),
        expected_version: 1,
      }),
    );
    assertEquals(renamed.version, 2);
    await assertRejects(() => deleteTag(deps, requestActor(A), p.id, 1), AppError);
    await deleteTag(deps, requestActor(A), p.id, 2);
    const concurrentName = "경쟁" + crypto.randomUUID().slice(0, 20);
    const results = await Promise.allSettled(
      [1, 2].map(() => createTag(deps, requestActor(A), tagCreate.parse({ ...{ name: concurrentName } }))),
    );
    assertEquals(results.filter((r) => r.status === "fulfilled").length, 1);
  } finally {
    await fixture.cleanup();
  }
});
dbTest("태그 parity: 빈 값·Unicode 30/31자와 trim", async () => {
  const fixture = await businessWorkspaceFixture(admin, sql);
  try {
    for (const name of ["", "😀".repeat(30), "😀".repeat(31)]) {
      let accepted = true;
      try {
        await admin.begin(async (tx) => {
          await tx`select set_config('request.workspace_id',${fixture.workspaceId},true)`;
          await tx`insert into app.tags(workspace_id,name) values (${fixture.workspaceId},${name})`;
          throw new Error("rollback");
        });
      } catch (e) {
        if ((e as Error).message !== "rollback") accepted = false;
      }
      assertEquals(accepted, tagCreate.safeParse({ ...{ name } }).success);
    }
    assertEquals(tagCreate.parse({ ...{ name: " 태그 " } }).name, "태그");
  } finally {
    await fixture.cleanup();
  }
});

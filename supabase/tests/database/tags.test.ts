import { assertEquals, assertRejects } from "@std/assert";
import { SqlTagUnitOfWork } from "../../functions/_shared/adapters/supabase/tag-store.ts";
import { tagCreate, tagListQuery, tagRename } from "../../functions/_shared/contracts/tag.ts";
import { createTag, deleteTag, listTags, renameTag } from "../../functions/_shared/core/tags/application.ts";
import { AppError } from "../../functions/_shared/core/shared/errors.ts";
import { connect, dbTest, devUsers, urls } from "./_db.ts";
const admin = connect(urls.admin, { max: 1 }), sql = connect(urls.pooler, { max: 3, prepare: false });
const users = await devUsers(admin), A = { userId: users.a }, B = { userId: users.b };
const deps = { uow: new SqlTagUnitOfWork(sql) };
dbTest("태그: 대소문자 중복·경쟁·버전·소유자 격리·멱등", async () => {
  const name = "Test" + crypto.randomUUID().slice(0, 20),
    input = tagCreate.parse({ name, request_id: crypto.randomUUID() });
  const p = await createTag(deps, A, input);
  assertEquals((await createTag(deps, A, input)).id, p.id);
  await assertRejects(() => createTag(deps, A, tagCreate.parse({ name: name.toLowerCase() })), AppError);
  await createTag(deps, B, tagCreate.parse({ name }));
  await assertRejects(() => deleteTag(deps, B, p.id, 1), AppError);
  const q = tagListQuery.parse({ limit: 1 }), page = await listTags(deps, A, q);
  if (page.next_cursor) await assertRejects(() => listTags(deps, B, { ...q, cursor: page.next_cursor! }), AppError);
  const renamed = await renameTag(
    deps,
    A,
    p.id,
    tagRename.parse({ name: "정정" + crypto.randomUUID().slice(0, 20), expected_version: 1 }),
  );
  assertEquals(renamed.version, 2);
  await assertRejects(() => deleteTag(deps, A, p.id, 1), AppError);
  await deleteTag(deps, A, p.id, 2);
  const concurrentName = "경쟁" + crypto.randomUUID().slice(0, 20);
  const results = await Promise.allSettled(
    [1, 2].map(() => createTag(deps, A, tagCreate.parse({ name: concurrentName }))),
  );
  assertEquals(results.filter((r) => r.status === "fulfilled").length, 1);
});
dbTest("태그 parity: 빈 값·Unicode 30/31자와 trim", async () => {
  for (const name of ["", "😀".repeat(30), "😀".repeat(31)]) {
    let accepted = true;
    try {
      await admin.begin(async (tx) => {
        await tx`insert into app.tags(owner_id,name) values (${A.userId},${name})`;
        throw new Error("rollback");
      });
    } catch (e) {
      if ((e as Error).message !== "rollback") accepted = false;
    }
    assertEquals(accepted, tagCreate.safeParse({ name }).success);
  }
  assertEquals(tagCreate.parse({ name: " 태그 " }).name, "태그");
});

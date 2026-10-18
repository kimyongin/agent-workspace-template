import { assertEquals, assertRejects } from "@std/assert";
import * as entities from "../../functions/_shared/core/entity/application.ts";
import * as tags from "../../functions/_shared/core/tags/application.ts";
import { entityCreate } from "../../functions/_shared/contracts/entity.ts";
import { SqlEntityUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-store.ts";
import { SqlTagUnitOfWork } from "../../functions/_shared/adapters/supabase/tag-store.ts";
import { AppError } from "../../functions/_shared/core/shared/errors.ts";
import { businessRequest, businessWorkspaceFixture } from "./_workspace-business.ts";
import { connect, dbTest, urls } from "./_db.ts";
const admin = connect(urls.admin, { max: 1 }), sql = connect(urls.direct, { max: 5, prepare: false });
const entityDeps = { uow: new SqlEntityUnitOfWork(sql) }, tagDeps = { uow: new SqlTagUnitOfWork(sql) };

dbTest("workspace entity tag connections reject foreign scope and roll back late record tag failure", async () => {
  const f = await businessWorkspaceFixture(admin, sql);
  try {
    const kind = await f.createKind("분류 대상");
    await f.grantKind(f.manager, kind.id, "write");
    await f.grantKind(f.member, kind.id, "read");
    const entity = await entities.createEntity(
      entityDeps,
      businessRequest(f.manager),
      entityCreate.parse({
        entity_type_id: kind.id,
        schema_version: 1,
        properties: { prop_1: "분류가 바뀌어도 보존" },
      }),
    );
    const entityTag = await tags.createTag(tagDeps, businessRequest(f.manager), { scope: "entity", name: "자료 태그" });
    const recordTag = await tags.createTag(tagDeps, businessRequest(f.manager), { scope: "record", name: "기록 전용" });
    const other = await f.addWorkspace("다른 분류 공간");
    const foreignTag = await tags.createTag(tagDeps, businessRequest(other.manager), {
      scope: "entity",
      name: "자료 태그",
    });
    const input = { target_kind: "entity", target_id: entity.id, expected_version: 1, tag_ids: [entityTag.id] };
    assertEquals(
      (await assertRejects(
        async () => await tags.setTagConnections(tagDeps, businessRequest(f.member), input),
        AppError,
      )).code,
      "forbidden",
    );
    for (const tag_id of [recordTag.id, foreignTag.id]) {
      assertEquals(
        (await assertRejects(
          async () =>
            await tags.setTagConnections(tagDeps, businessRequest(f.manager), { ...input, tag_ids: [tag_id] }),
          AppError,
        ))
          .code,
        "invalid_reference",
      );
    }
    assertEquals(
      (await assertRejects(
        async () => await tags.setTagConnections(tagDeps, businessRequest(other.manager), input),
        AppError,
      )).code,
      "not_found",
    );
    const request = businessRequest(f.manager);
    // This invalid automatic-record scope is checked after the target links,
    // version and record insert, so rejection proves the transaction rolls back.
    assertEquals(
      (await assertRejects(
        async () => await tags.setTagConnections(tagDeps, request, { ...input, change_tag_ids: [entityTag.id] }),
        AppError,
      )).code,
      "invalid_reference",
    );
    const before = await entities.getEntity(entityDeps, f.manager, entity.id);
    assertEquals([before.tag_ids, before.version, before.properties.prop_1, before.records.count], [
      [],
      1,
      "분류가 바뀌어도 보존",
      1,
    ]);
    const [receipt] =
      await admin`select count(*) n from private.workspace_request_results where workspace_id=${f.workspaceId} and request_key=${
        request.request!.key
      }`;
    assertEquals(Number(receipt.n), 0);
    const linkedRequest = businessRequest(f.manager);
    const linked = await tags.setTagConnections(tagDeps, linkedRequest, input);
    assertEquals([linked.tag_ids, linked.version], [[entityTag.id], 2]);
    assertEquals(await tags.setTagConnections(tagDeps, linkedRequest, input), linked);
    assertEquals(
      (await assertRejects(
        async () => await tags.setTagConnections(tagDeps, businessRequest(f.manager), { ...input, tag_ids: [] }),
        AppError,
      )).code,
      "conflict",
    );
    await f.grantKind(f.manager, kind.id, "read");
    assertEquals(
      (await assertRejects(async () => await tags.setTagConnections(tagDeps, linkedRequest, input), AppError)).code,
      "forbidden",
    );
    const after = await entities.getEntity(entityDeps, f.member, entity.id);
    assertEquals([after.tag_ids, after.version, after.records.count], [[entityTag.id], 2, 2]);
  } finally {
    await f.cleanup();
  }
});

dbTest("workspace tag deletion authorizes every hidden affected kind before any unlink or receipt", async () => {
  const f = await businessWorkspaceFixture(admin, sql);
  try {
    const left = await f.createKind("공개 분류"), right = await f.createKind("비공개 분류");
    for (const kind of [left, right]) await f.grantKind(f.manager, kind.id, "write");
    await f.grantKind(f.member, left.id, "write");
    const values = [];
    for (const kind of [left, right]) {
      values.push(
        await entities.createEntity(
          entityDeps,
          businessRequest(f.manager),
          entityCreate.parse({ entity_type_id: kind.id, schema_version: 1, properties: { prop_1: "분류 대상" } }),
        ),
      );
    }
    const tag = await tags.createTag(tagDeps, businessRequest(f.manager), { scope: "entity", name: "함께 쓰는 분류" });
    for (const value of values) {
      await tags.setTagConnections(tagDeps, businessRequest(f.manager), {
        target_kind: "entity",
        target_id: value.id,
        expected_version: 1,
        tag_ids: [tag.id],
      });
    }
    const deniedRequest = businessRequest(f.member);
    const denied = await assertRejects(async () => await tags.deleteTag(tagDeps, deniedRequest, tag.id, 1), AppError);
    assertEquals(denied.code, "forbidden");
    for (const value of values) {
      const unchanged = await entities.getEntity(entityDeps, f.manager, value.id);
      assertEquals([unchanged.tag_ids, unchanged.version, unchanged.records.count], [[tag.id], 2, 2]);
    }
    assertEquals(
      Number(
        (await admin`select count(*) n from private.workspace_request_results where workspace_id=${f.workspaceId} and request_key=${
          deniedRequest.request!.key
        }`)[0].n,
      ),
      0,
    );
    await f.grantKind(f.member, right.id, "write");
    const request = businessRequest(f.member);
    assertEquals(await tags.deleteTag(tagDeps, request, tag.id, 1), { deleted: true });
    assertEquals(await tags.deleteTag(tagDeps, request, tag.id, 1), { deleted: true });
    for (const value of values) {
      const changed = await entities.getEntity(entityDeps, f.manager, value.id);
      assertEquals([changed.tag_ids, changed.version, changed.records.count], [[], 3, 3]);
    }
    assertEquals((await tags.listTags(tagDeps, f.manager, { scope: "entity", limit: 100 })).items, []);
    const [receipt] =
      await admin`select footprint from private.workspace_request_results where workspace_id=${f.workspaceId} and request_key=${
        request.request!.key
      }`;
    assertEquals(
      receipt.footprint,
      [left.id, right.id].sort().map((target_id) => ({ target_kind: "entity_type", target_id, access: "write" })),
    );
    await f.grantKind(f.member, right.id, "none");
    assertEquals(
      (await assertRejects(async () => await tags.deleteTag(tagDeps, request, tag.id, 1), AppError)).code,
      "forbidden",
    );
  } finally {
    await f.cleanup();
  }
});

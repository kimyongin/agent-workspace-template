import { SqlCreateAndLinkUnitOfWork } from "../../functions/_shared/adapters/supabase/create-and-link-store.ts";
import { createAndLinkEntity } from "../../functions/_shared/core/entity-relations/create-and-link.ts";
import { SqlTagUnitOfWork } from "../../functions/_shared/adapters/supabase/tag-store.ts";
import { createTag } from "../../functions/_shared/core/tags/application.ts";
import { assertEquals, assertRejects } from "@std/assert";
import { SqlEntityUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-store.ts";
import { SqlEntityRelationDefinitionUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-relation-definition-store.ts";
import { SqlEntityRelationLinkUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-relation-link-store.ts";
import * as entities from "../../functions/_shared/core/entity/application.ts";
import * as definitions from "../../functions/_shared/core/entity-relations/application.ts";
import * as links from "../../functions/_shared/core/entity-relations/links.ts";
import { AppError } from "../../functions/_shared/core/shared/errors.ts";
import { businessRequest, businessWorkspaceFixture } from "./_workspace-business.ts";
import { connect, dbTest, urls } from "./_db.ts";

dbTest(
  "workspace relations authorize both ends and retain safe single parent histories for future readers",
  async () => {
    const admin = connect(urls.admin, { max: 1 }), sql = connect(urls.direct, { max: 5, prepare: false });
    const entityDeps = { uow: new SqlEntityUnitOfWork(sql) };
    const definitionDeps = { uow: new SqlEntityRelationDefinitionUnitOfWork(sql) };
    const linkDeps = { uow: new SqlEntityRelationLinkUnitOfWork(sql) };

    const f = await businessWorkspaceFixture(admin, sql);
    try {
      const left = await f.createKind("공개 종류"), right = await f.createKind("보호 종류");
      for (const kind of [left, right]) {
        await f.grantKind(f.manager, kind.id, "write");
        await f.grantKind(f.member, kind.id, "write");
      }
      const def = await definitions.createEntityRelationDefinition(definitionDeps, businessRequest(f.manager), {
        ends: [{ type_id: left.id, label: "연결", cardinality: "one" }, {
          type_id: right.id,
          label: "역방향",
          cardinality: "many",
        }],
      });
      const origin = await entities.createEntity(entityDeps, businessRequest(f.manager), {
        entity_type_id: left.id,
        schema_version: 1,
        properties: { prop_1: "원점 공개 이름" },
      });
      const peer = await entities.createEntity(entityDeps, businessRequest(f.manager), {
        entity_type_id: right.id,
        schema_version: 1,
        properties: { prop_1: "SECRET-PEER-CAPTURE" },
      });
      const relation = { definition_id: def.id, side: 0, origin_id: origin.id };
      const candidate = await links.listEntityRelationLinks(linkDeps, f.member, { ...relation, limit: 1 }, true);
      assertEquals(candidate.items.map((item) => item.id), [peer.id]);
      const input = {
        ...relation,
        other_id: peer.id,
        expected_definition_version: 1,
        expected_version: 1,
        expected_other_version: 1,
      };
      const request = businessRequest(f.member);
      const saved = await links.connectEntityRelation(linkDeps, request, input);
      assertEquals(saved.changed, true);
      assertEquals(await links.connectEntityRelation(linkDeps, request, input), saved);
      assertEquals((await entities.getEntity(entityDeps, f.member, origin.id)).records.count, 2);
      assertEquals((await entities.getEntity(entityDeps, f.member, peer.id)).records.count, 2);
      const changedRecords = await admin`select entity_id,task_id,entity_ids,entity_context from app.records
      where workspace_id=${f.workspaceId} and change_metadata->>'action'='update'`;
      assertEquals(changedRecords.length, 2);
      assertEquals(
        changedRecords.every((record) =>
          record.entity_id !== null && record.task_id === null && record.entity_ids.length === 0 &&
          record.entity_context.length === 0
        ),
        true,
      );
      await f.grantKind(f.member, right.id, "none");
      const future = await entities.getEntity(entityDeps, f.member, origin.id);
      assertEquals(JSON.stringify(future.records).includes("SECRET-PEER-CAPTURE"), false);
      await assertRejects(() => links.listEntityRelationLinks(linkDeps, f.member, relation), AppError);
      await assertRejects(() => links.connectEntityRelation(linkDeps, request, input), AppError);
      const other = await f.addWorkspace("다른 관계 공간");
      await assertRejects(() => links.listEntityRelationLinks(linkDeps, other.manager, relation), AppError);
    } finally {
      await f.cleanup();
      await sql.end();
      await admin.end();
    }
  },
);

dbTest(
  "workspace create and replace rolls back new entity links versions histories queue and receipt together",
  async () => {
    const admin = connect(urls.admin, { max: 1 }), sql = connect(urls.direct, { max: 5, prepare: false });
    const f = await businessWorkspaceFixture(admin, sql);
    const entityDeps = { uow: new SqlEntityUnitOfWork(sql) },
      definitionDeps = { uow: new SqlEntityRelationDefinitionUnitOfWork(sql) },
      linkDeps = { uow: new SqlEntityRelationLinkUnitOfWork(sql) };
    const createDeps = { uow: new SqlCreateAndLinkUnitOfWork(sql) };
    try {
      const left = await f.createKind("작성 원점"), right = await f.createKind("작성 상대");
      for (const kind of [left, right]) {
        await f.grantKind(f.manager, kind.id, "write");
        await f.grantKind(f.member, kind.id, "write");
      }
      const def = await definitions.createEntityRelationDefinition(definitionDeps, businessRequest(f.manager), {
        ends: [
          { type_id: left.id, label: "원점", cardinality: "one" },
          { type_id: right.id, label: "상대", cardinality: "one" },
        ],
      });
      const origin = await entities.createEntity(entityDeps, businessRequest(f.manager), {
        entity_type_id: left.id,
        schema_version: 1,
        properties: { prop_1: "작성 원점" },
      });
      const previous = await entities.createEntity(entityDeps, businessRequest(f.manager), {
        entity_type_id: right.id,
        schema_version: 1,
        properties: { prop_1: "기존 상대" },
      });
      const relation = { definition_id: def.id, side: 0, origin_id: origin.id };
      await links.connectEntityRelation(linkDeps, businessRequest(f.member), {
        ...relation,
        other_id: previous.id,
        expected_definition_version: 1,
        expected_version: 1,
        expected_other_version: 1,
      });
      const input = {
        ...relation,
        expected_definition_version: 1,
        expected_version: 2,
        previous_other_id: previous.id,
        expected_previous_version: 2,
        entity: { entity_type_id: right.id, schema_version: 1, properties: { prop_1: "새 상대" } },
      };
      const invalidRecordTag = await createTag({ uow: new SqlTagUnitOfWork(sql) }, businessRequest(f.manager), {
        scope: "entity",
        name: "기록용 아님",
      });
      const before = await entities.getEntity(entityDeps, f.member, origin.id);
      const beforePeer = await entities.getEntity(entityDeps, f.member, previous.id);
      const beforeList = await entities.listEntities(entityDeps, f.member, {
        entity_type_id: right.id,
        limit: 20,
        sort: "updated_at",
      });
      const request = businessRequest(f.member);
      assertEquals(
        (await assertRejects(
          () => createAndLinkEntity(createDeps, request, { ...input, change_tag_ids: [invalidRecordTag.id] }),
          AppError,
        )).code,
        "invalid_reference",
      );
      assertEquals(await entities.getEntity(entityDeps, f.member, origin.id), before);
      assertEquals(await entities.getEntity(entityDeps, f.member, previous.id), beforePeer);
      assertEquals(
        await entities.listEntities(entityDeps, f.member, { entity_type_id: right.id, limit: 20, sort: "updated_at" }),
        beforeList,
      );
      assertEquals((await links.listEntityRelationLinks(linkDeps, f.member, relation)).items.map((item) => item.id), [
        previous.id,
      ]);
      const [receipt] =
        await admin`select count(*)::int n from private.workspace_request_results where workspace_id=${f.workspaceId} and request_key=${
          request.request!.key
        }`;
      assertEquals(receipt.n, 0);
      assertEquals(
        await admin`select msg_id,message from pgmq.q_search_index where message->>'workspace_id'=${f.workspaceId} order by msg_id`,
        queued,
      );
      const successful = businessRequest(f.member), saved = await createAndLinkEntity(createDeps, successful, input);
      assertEquals(await createAndLinkEntity(createDeps, successful, input), saved);
      assertEquals(saved.entity.version, 2);
      assertEquals((await entities.getEntity(entityDeps, f.member, origin.id)).version, 3);
      assertEquals((await entities.getEntity(entityDeps, f.member, previous.id)).version, 3);
      assertEquals((await entities.getEntity(entityDeps, f.member, previous.id)).records.count, 3);
      assertEquals((await links.listEntityRelationLinks(linkDeps, f.member, relation)).items.map((item) => item.id), [
        saved.entity.id,
      ]);
    } finally {
      await f.cleanup();
      await sql.end();
      await admin.end();
    }
  },
);

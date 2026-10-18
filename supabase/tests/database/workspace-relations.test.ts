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
const admin = connect(urls.admin, { max: 1 }), sql = connect(urls.direct, { max: 5, prepare: false });
const entityDeps = { uow: new SqlEntityUnitOfWork(sql) };
const definitionDeps = { uow: new SqlEntityRelationDefinitionUnitOfWork(sql) };
const linkDeps = { uow: new SqlEntityRelationLinkUnitOfWork(sql) };

dbTest(
  "workspace relations authorize both ends and retain safe single parent histories for future readers",
  async () => {
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

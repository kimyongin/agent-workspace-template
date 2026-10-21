import { assertEquals, assertRejects } from "@std/assert";
import { SqlEntityUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-store.ts";
import { SqlEntityRelationDefinitionUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-relation-definition-store.ts";
import { entityCreate } from "../../functions/_shared/contracts/entity.ts";
import * as entities from "../../functions/_shared/core/entity/application.ts";
import * as relations from "../../functions/_shared/core/entity-relations/application.ts";
import { asUser, connect, dbTest, urls } from "./_db.ts";
import { businessRequest, businessWorkspaceFixture } from "./_workspace-business.ts";

const admin = connect(urls.admin, { max: 1 });
const user = connect(urls.direct, { max: 2, prepare: false });

dbTest(
  "entity storage refuses unassigned historical rows and current workspace reads remain permission scoped",
  async () => {
    const fixture = await businessWorkspaceFixture(admin, user);
    try {
      const other = await fixture.addWorkspace("별도 자료 공간");
      const kind = await fixture.createKind("현재 자료 종류");
      await fixture.grantKind(fixture.manager, kind.id, "write");
      const current = await entities.createEntity(
        { uow: new SqlEntityUnitOfWork(user) },
        businessRequest(fixture.manager),
        entityCreate.parse({ entity_type_id: kind.id, schema_version: 1, properties: { prop_1: "공간 자료" } }),
      );
      const read = (workspaceId?: string, actor = fixture.member.userId) =>
        asUser(user, actor, async (tx) => {
          await tx`select set_config('request.workspace_id',${workspaceId ?? ""},true)`;
          return (await tx`select id from app.entities where id=${current.id}`).map((row) => row.id);
        });
      assertEquals(await read(fixture.workspaceId, fixture.manager.userId), [current.id]);
      assertEquals(await read(), []);
      assertEquals(await read(other.workspaceId), []);
      assertEquals(await read(fixture.workspaceId), []);
      await fixture.grantKind(fixture.member, kind.id, "read");
      assertEquals(await read(fixture.workspaceId), [current.id]);
      const error = await assertRejects(() =>
        admin.begin(async (tx) => {
          // Even privileged fixture DML that bypasses triggers cannot reintroduce
          // the old NULL ownership graph: NOT NULL is a storage constraint.
          await tx`set local session_replication_role='replica'`;
          await tx`insert into app.entities(id,source,external_id,entity_type_id,schema_version,properties)
        values(${`app:${kind.id}:unassigned`},'app','unassigned',${kind.id},1,'{}')`;
        })
      );
      assertEquals((error as { code?: string }).code, "23502");
    } finally {
      await fixture.cleanup();
    }
  },
);

dbTest("relation storage refuses NULL workspace while metadata reads require current settings permission", async () => {
  const fixture = await businessWorkspaceFixture(admin, user);
  try {
    const other = await fixture.addWorkspace("별도의 관계 공간");
    const kind = await fixture.createKind("현재 관계 종류");
    const current = await relations.createEntityRelationDefinition(
      { uow: new SqlEntityRelationDefinitionUnitOfWork(user) },
      businessRequest(fixture.manager),
      {
        ends: [{ type_id: kind.id, label: "앞", cardinality: "many" }, {
          type_id: kind.id,
          label: "뒤",
          cardinality: "many",
        }],
      },
    );
    const read = (workspaceId?: string, actor = fixture.member.userId) =>
      asUser(user, actor, async (tx) => {
        await tx`select set_config('request.workspace_id',${workspaceId ?? ""},true)`;
        return (await tx`select id from app.entity_relation_definitions where id=${current.id}`).map((row) => row.id);
      });
    assertEquals(await read(fixture.workspaceId, fixture.manager.userId), [current.id]);
    assertEquals(await read(), []);
    assertEquals(await read(other.workspaceId), []);
    assertEquals(await read(fixture.workspaceId), []);
    await fixture.grant(fixture.member, [{ target_kind: "settings", target_id: "*", access: "read" }]);
    assertEquals(await read(fixture.workspaceId), [current.id]);
    const error = await assertRejects(() =>
      admin.begin(async (tx) => {
        await tx`set local session_replication_role='replica'`;
        await tx`insert into app.entity_relation_definitions(id,left_type_id,left_label,left_cardinality,right_type_id,right_label,right_cardinality)
        values(${crypto.randomUUID()},${kind.id},'앞','many',${kind.id},'뒤','many')`;
      })
    );
    assertEquals((error as { code?: string }).code, "23502");
  } finally {
    await fixture.cleanup();
  }
});

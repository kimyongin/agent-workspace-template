import { assertEquals } from "@std/assert";
import { entityCreate } from "../../functions/_shared/contracts/entity.ts";
import { initialEntityDefinition } from "../../functions/_shared/contracts/entity-type.ts";
import { SqlEntityUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-store.ts";
import { SqlEntityRelationDefinitionUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-relation-definition-store.ts";
import * as entities from "../../functions/_shared/core/entity/application.ts";
import * as relations from "../../functions/_shared/core/entity-relations/application.ts";
import { asUser, connect, dbTest, urls } from "./_db.ts";
import { businessRequest, businessWorkspaceFixture } from "./_workspace-business.ts";

const admin = connect(urls.admin, { max: 1 });
const user = connect(urls.direct, { max: 2, prepare: false });

dbTest(
  "unassigned historical entity rows remain preserved but unreadable without the current workspace and kind permission",
  async () => {
    const fixture = await businessWorkspaceFixture(admin, user);
    const legacyType = crypto.randomUUID(), externalId = crypto.randomUUID();
    const legacyId = `app:${legacyType}:${externalId}`;
    const actor = fixture.manager.userId;
    let seeded = false;
    try {
      const other = await fixture.addWorkspace("같은 실행자의 별도 공간");
      const kind = await fixture.createKind("현재 공간의 자료");
      await fixture.grantKind(fixture.manager, kind.id, "write");
      const current = await entities.createEntity(
        { uow: new SqlEntityUnitOfWork(user) },
        businessRequest(fixture.manager),
        entityCreate.parse({
          entity_type_id: kind.id,
          schema_version: 1,
          properties: { prop_1: "현재 권한으로 읽는 값" },
        }),
      );
      const definition = initialEntityDefinition("이관 전 값", { id: legacyType });
      // Privileged fixture preparation represents an existing pre-cutover graph.
      // Transaction-local bypass is never used by the app_user read assertions.
      await admin.begin(async (tx) => {
        await tx`set local session_replication_role='replica'`;
        await tx`insert into app.entity_types(owner_id,id) values(${actor},${legacyType})`;
        await tx`insert into app.entity_schema_versions(owner_id,schema) values(${actor},${
          tx.json(definition.schema as never)
        })`;
        await tx`insert into app.entity_issuers(owner_id,code,label,system) values(${actor},'app','앱',true)`;
        await tx`insert into app.entity_identifier_rules(owner_id,id,source,label,meaning,generation)
        values(${actor},'00000000-0000-4000-8000-000000000001','app','자동 발급','앱이 발급한 자료 번호','automatic')`;
        await tx`insert into app.entity_type_identity(owner_id,type_id,default_source) values(${actor},${legacyType},'app')`;
        await tx`insert into app.entity_type_identity_sources(owner_id,type_id,code,rule_id,referenced)
        values(${actor},${legacyType},'app','00000000-0000-4000-8000-000000000001',true)`;
        await tx`insert into app.entities(owner_id,id,source,external_id,entity_type_id,schema_version,properties)
        values(${actor},${legacyId},'app',${externalId},${legacyType},1,'{"prop_1":"보존하지만 공개하지 않는 이관 전 값"}')`;
      });
      seeded = true;
      const before =
        await admin`select * from app.entities where id=${legacyId} and workspace_id is null and owner_id=${actor}`;
      const authBefore = await admin`select id,raw_user_meta_data,raw_app_meta_data from auth.users where id=${actor}`;
      const read = (workspaceId?: string, id?: string) =>
        asUser(user, actor, async (tx) => {
          await tx`select set_config('request.workspace_id',${workspaceId ?? ""},true)`;
          return (await tx`select id from app.entities where id=any(${
            id ? [id] : [legacyId, current.id]
          }::text[]) order by id`).map((row) => row.id);
        });
      assertEquals(await read(fixture.workspaceId, current.id), [current.id]);
      const noWorkspace = await read();
      const unrelatedWorkspace = await read(other.workspaceId);
      await fixture.grantKind(fixture.manager, kind.id, "none");
      const noKindPermission = await read(fixture.workspaceId);
      assertEquals({ noWorkspace, unrelatedWorkspace, noKindPermission }, {
        noWorkspace: [],
        unrelatedWorkspace: [],
        noKindPermission: [],
      });
      await fixture.grantKind(fixture.manager, kind.id, "read");
      assertEquals(await read(fixture.workspaceId), [current.id]);
      assertEquals(
        await admin`select * from app.entities where id=${legacyId} and workspace_id is null and owner_id=${actor}`,
        before,
      );
      assertEquals(
        await admin`select id,raw_user_meta_data,raw_app_meta_data from auth.users where id=${actor}`,
        authBefore,
      );
    } finally {
      if (seeded) {
        await admin.begin(async (tx) => {
          await tx`set local session_replication_role='replica'`;
          await tx`delete from app.entities where id=${legacyId} and workspace_id is null and owner_id=${actor}`;
          await tx`delete from app.entity_type_identity_sources where type_id=${legacyType} and workspace_id is null and owner_id=${actor}`;
          await tx`delete from app.entity_type_identity where type_id=${legacyType} and workspace_id is null and owner_id=${actor}`;
          await tx`delete from app.entity_identifier_rules where id='00000000-0000-4000-8000-000000000001' and workspace_id is null and owner_id=${actor}`;
          await tx`delete from app.entity_issuers where code='app' and workspace_id is null and owner_id=${actor}`;
          await tx`delete from app.entity_schema_versions where type_id=${legacyType} and workspace_id is null and owner_id=${actor}`;
          await tx`delete from app.entity_types where id=${legacyType} and workspace_id is null and owner_id=${actor}`;
        });
      }
      await fixture.cleanup();
    }
  },
);

dbTest(
  "unassigned historical relation definitions stay hidden without current workspace metadata authority",
  async () => {
    const fixture = await businessWorkspaceFixture(admin, user);
    const legacyType = crypto.randomUUID(), legacyDefinition = crypto.randomUUID();
    const actor = fixture.member.userId;
    let seeded = false;
    try {
      const other = await fixture.addWorkspace("관계 설정이 없는 다른 공간");
      const kind = await fixture.createKind("현재 공간의 관계 종류");
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
      const definition = initialEntityDefinition("이관 전 관계 종류", { id: legacyType });
      await admin.begin(async (tx) => {
        // Fixture-only representation of the preserved pre-cutover ownership graph.
        await tx`set local session_replication_role='replica'`;
        await tx`insert into app.entity_types(owner_id,id) values(${actor},${legacyType})`;
        await tx`insert into app.entity_schema_versions(owner_id,schema) values(${actor},${
          tx.json(definition.schema as never)
        })`;
        await tx`insert into app.entity_relation_definitions(owner_id,id,left_type_id,left_label,left_cardinality,right_type_id,right_label,right_cardinality)
        values(${actor},${legacyDefinition},${legacyType},'과거 앞','many',${legacyType},'과거 뒤','many')`;
      });
      seeded = true;
      const before =
        await admin`select * from app.entity_relation_definitions where id=${legacyDefinition} and workspace_id is null and owner_id=${actor}`;
      const authBefore = await admin`select id,raw_user_meta_data,raw_app_meta_data from auth.users where id=${actor}`;
      const read = (workspaceId?: string, reader = actor, id?: string) =>
        asUser(user, reader, async (tx) => {
          await tx`select set_config('request.workspace_id',${workspaceId ?? ""},true)`;
          return (await tx`select id from app.entity_relation_definitions where id=any(${
            id ? [id] : [legacyDefinition, current.id]
          }::uuid[]) order by id`).map((row) => row.id);
        });
      assertEquals(await read(fixture.workspaceId, fixture.manager.userId, current.id), [current.id]);
      const noWorkspace = await read();
      const unrelatedWorkspace = await read(other.workspaceId);
      const noSettingsOrKinds = await read(fixture.workspaceId);
      assertEquals({ noWorkspace, unrelatedWorkspace, noSettingsOrKinds }, {
        noWorkspace: [],
        unrelatedWorkspace: [],
        noSettingsOrKinds: [],
      });
      await fixture.grant(fixture.member, [{ target_kind: "settings", target_id: "*", access: "read" }]);
      assertEquals(await read(fixture.workspaceId), [current.id]);
      assertEquals(
        await admin`select * from app.entity_relation_definitions where id=${legacyDefinition} and workspace_id is null and owner_id=${actor}`,
        before,
      );
      assertEquals(
        await admin`select id,raw_user_meta_data,raw_app_meta_data from auth.users where id=${actor}`,
        authBefore,
      );
    } finally {
      if (seeded) {
        await admin.begin(async (tx) => {
          await tx`set local session_replication_role='replica'`;
          await tx`delete from app.entity_relation_definitions where id=${legacyDefinition} and workspace_id is null and owner_id=${actor}`;
          await tx`delete from app.entity_schema_versions where type_id=${legacyType} and workspace_id is null and owner_id=${actor}`;
          await tx`delete from app.entity_types where id=${legacyType} and workspace_id is null and owner_id=${actor}`;
        });
      }
      await fixture.cleanup();
    }
  },
);

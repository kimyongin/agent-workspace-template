import { configureIdentifierField } from "./_entity.ts";
import { encodeIdentifierValue } from "../../functions/_shared/contracts/entity-identifiers.ts";
import { getEntitySchema } from "../../functions/_shared/core/entity-types/application.ts";
import {
  analyzeEntitySchemaChange,
  applyEntitySchemaChange,
  createEntitySchemaChange,
} from "../../functions/_shared/core/entity-types/schema-changes.ts";
import { SqlEntityUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-store.ts";
import { createEntity, deleteEntity, getEntity } from "../../functions/_shared/core/entity/application.ts";
import { assertEquals, assertRejects } from "@std/assert";
import { connect, dbTest, urls } from "./_db.ts";
import { businessWorkspaceFixture } from "./_workspace-business.ts";
import { runInWorkspace } from "../../functions/_shared/adapters/supabase/workspace-context.ts";
import type { WorkspaceActor } from "../../functions/_shared/core/workspaces/application.ts";
import type postgres from "postgres";
import { requestActor } from "../_request.ts";
import { SqlEntityIssuerUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-issuer-store.ts";
import { SqlEntityTypeUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-type-store.ts";
import { createEntityType, getEntityType } from "../../functions/_shared/core/entity-types/application.ts";
import {
  createEntityIssuer,
  createIdentifierRule,
  listEntityIssuers,
  listIdentifierRules,
  updateEntityIssuer,
  updateIdentifierRule,
} from "../../functions/_shared/core/entity-issuers/application.ts";
import { APP_IDENTIFIER_RULE_ID } from "../../functions/_shared/contracts/entity-issuer.ts";
import { AppError } from "../../functions/_shared/core/shared/errors.ts";
function asSettings<T>(sql: postgres.Sql, actor: WorkspaceActor, fn: (tx: postgres.TransactionSql) => Promise<T>) {
  return runInWorkspace(sql, actor, {
    mode: "business",
    requirements: [{ target_kind: "settings", target_id: "*", access: "write" }],
  }, fn);
}
dbTest(
  "issuer registry: field defaults, rule reuse, workspace boundaries, disable and concurrent settings",
  async () => {
    const admin = connect(urls.admin), sql = connect(urls.direct, { max: 3 });
    const a = await businessWorkspaceFixture(admin, sql), b = await businessWorkspaceFixture(admin, sql);
    const d = { uow: new SqlEntityIssuerUnitOfWork(sql) }, types = { uow: new SqlEntityTypeUnitOfWork(sql) };
    try {
      const product = await createEntityType(types, requestActor(a.manager), { label: "상품" });
      const order = await createEntityType(types, requestActor(a.manager), { label: "주문" });
      await a.grantKind(a.manager, product.id, "write");
      await a.grantKind(a.manager, order.id, "write");
      const initial = await getEntitySchema(types, a.manager, { type_id: product.id });
      assertEquals(initial.schema.properties.prop_2["x-identifier"], {
        allowed_kind_ids: [APP_IDENTIFIER_RULE_ID],
        default_kind_id: APP_IDENTIFIER_RULE_ID,
      });
      assertEquals(initial.identifier_kinds?.map((kind) => [kind.id, kind.source_label, kind.label, kind.generation]), [
        [APP_IDENTIFIER_RULE_ID, "앱", "자동 발급", "automatic"],
      ]);
      assertEquals("identity" in await getEntityType(types, a.manager, product.id), false);
      const source = await createEntityIssuer(d, requestActor(a.manager), { code: "coupang", label: "쿠팡" });
      const rule = await createIdentifierRule(d, requestActor(a.manager), source.code, {
        label: "상품 ID",
        meaning: "쿠팡의 상품 한 등록 건",
      });
      assertEquals(rule.generation, "direct");
      const settings = { allowed_kind_ids: [APP_IDENTIFIER_RULE_ID, rule.id], default_kind_id: rule.id };
      await configureIdentifierField(sql, a.manager, product.id, settings);
      await configureIdentifierField(sql, a.manager, order.id, settings);
      assertEquals((await listIdentifierRules(d, a.manager, source.code)).items.map((rule) => rule.id), [rule.id]);
      assertEquals((await listEntityIssuers(d, b.manager)).items, []);
      assertEquals(
        (await assertRejects(() => getEntitySchema(types, b.manager, { type_id: product.id }), AppError)).code,
        "not_found",
      );
      await assertRejects(() => configureIdentifierField(sql, b.manager, product.id, settings), AppError);
      // Definition edits now own identity settings and their one optimistic version.
      const current = await getEntitySchema(types, a.manager, { type_id: product.id });
      const payload = {
        expected_schema_version: current.schema_version,
        edits: [{
          op: "update_property" as const,
          key: "prop_2",
          required: true,
          field: { ...current.schema.properties.prop_2, title: "상품 번호" },
        }],
      };
      const writer = requestActor(a.manager);
      const draft = await createEntitySchemaChange(types, writer, product.id, payload);
      assertEquals(await createEntitySchemaChange(types, writer, product.id, payload), draft);
      const review = await analyzeEntitySchemaChange(types, requestActor(a.manager), product.id, draft.id, {
        expected_change_version: draft.version,
      });
      const races = await Promise.allSettled(
        [1, 2].map(() =>
          applyEntitySchemaChange(types, requestActor(a.manager), product.id, draft.id, {
            expected_change_version: draft.version,
            analysis_id: review.analysis_id,
          })
        ),
      );
      assertEquals(
        races.filter((result) => result.status === "fulfilled").length,
        1,
      );
      assertEquals(
        (await assertRejects(
          () => createEntitySchemaChange(types, requestActor(a.manager), product.id, payload),
          AppError,
        )).code,
        "schema_changed",
      );
      await assertRejects(() =>
        updateEntityIssuer(d, requestActor(a.manager), source.code, {
          expected_version: source.version,
          active: false,
        }), AppError);
      await assertRejects(
        () => updateIdentifierRule(d, requestActor(a.manager), rule.id, { expected_version: 1, active: false }),
        AppError,
      );
      for (const id of [product.id, order.id]) {
        await configureIdentifierField(sql, a.manager, id, { ...settings, default_kind_id: APP_IDENTIFIER_RULE_ID });
      }
      const before = await getEntitySchema(types, a.manager, { type_id: product.id });
      const stopRequest = requestActor(a.manager);
      const stopped = await updateIdentifierRule(d, stopRequest, rule.id, { expected_version: 1, active: false });
      assertEquals(
        await updateIdentifierRule(d, stopRequest, rule.id, { expected_version: 1, active: false }),
        stopped,
      );
      const after = await getEntitySchema(types, a.manager, { type_id: product.id });
      assertEquals(after.schema, before.schema, "registry stop never rewrites the published field definition");
      assertEquals(
        after.identifier_kinds?.find((kind) => kind.id === rule.id)?.active,
        false,
      );
      await updateEntityIssuer(d, requestActor(a.manager), source.code, {
        expected_version: source.version,
        active: false,
      });
      assertEquals(
        (await listEntityIssuers(d, a.manager)).items.find((source) => source.code === "coupang")?.active,
        false,
      );
    } finally {
      await a.cleanup();
      await b.cleanup();
      await sql.end();
      await admin.end();
    }
  },
);

dbTest("issuer registry: deleted entities retain kind meaning and selected field references", async () => {
  const admin = connect(urls.admin), sql = connect(urls.direct);
  const a = await businessWorkspaceFixture(admin, sql);
  const d = { uow: new SqlEntityIssuerUnitOfWork(sql) },
    types = { uow: new SqlEntityTypeUnitOfWork(sql) },
    entities = { uow: new SqlEntityUnitOfWork(sql) };
  try {
    const type = await createEntityType(types, requestActor(a.manager), { label: "상품" });
    await a.grantKind(a.manager, type.id, "write");
    await createEntityIssuer(d, requestActor(a.manager), { code: "coupang", label: "쿠팡" });
    const rule = await createIdentifierRule(d, requestActor(a.manager), "coupang", {
      label: "상품 ID",
      meaning: "쿠팡 상품 등록 ID",
    });
    const alternative = await createIdentifierRule(d, requestActor(a.manager), "coupang", {
      label: "판매자 번호",
      meaning: "판매자 상품 번호",
    });
    const settings = { allowed_kind_ids: [APP_IDENTIFIER_RULE_ID, rule.id], default_kind_id: APP_IDENTIFIER_RULE_ID };
    const configured = await configureIdentifierField(sql, a.manager, type.id, settings);
    const entity = await createEntity(entities, requestActor(a.manager), {
      ...configured.schema,
      properties: { prop_1: "운동화", prop_2: encodeIdentifierValue(rule.id, "00123") },
    });
    await deleteEntity(entities, requestActor(a.manager), entity.id, entity.version);
    for (
      const operation of [
        () => deleteIdentifierRule(d, requestActor(a.manager), rule.id, { expected_version: 1 }),
        () => deleteEntityIssuer(d, requestActor(a.manager), "coupang", { expected_version: 1 }),
        () =>
          updateIdentifierRule(d, requestActor(a.manager), rule.id, { meaning: "다른 번호 의미", expected_version: 1 }),
      ]
    ) assertEquals((await assertRejects(operation, AppError)).code, "invalid_input");
    // Replacing/removing a retained kind from its selected field cannot reinterpret tombstones.
    for (const allowed_kind_ids of [[APP_IDENTIFIER_RULE_ID, alternative.id], [APP_IDENTIFIER_RULE_ID]]) {
      await assertRejects(
        () => configureIdentifierField(sql, a.manager, type.id, { ...settings, allowed_kind_ids }),
        AppError,
      );
    }
    await updateIdentifierRule(d, requestActor(a.manager), rule.id, { expected_version: 1, active: false });
    assertEquals(
      (await getEntitySchema(types, a.manager, { type_id: type.id })).identifier_kinds?.find((kind) =>
        kind.id === rule.id
      )?.active,
      false,
    );
    await updateIdentifierRule(d, requestActor(a.manager), rule.id, { label: "외부 상품 번호", expected_version: 2 });
    await assertRejects(() =>
      asSettings(sql, a.manager, (tx) => tx`update app.entity_identifier_rules set meaning='우회' where id=${rule.id}`)
    );
    await assertRejects(() =>
      asSettings(sql, a.manager, (tx) => tx`delete from app.entity_identifier_rules where id=${rule.id}`)
    );
  } finally {
    await a.cleanup();
    await sql.end();
    await admin.end();
  }
});

dbTest(
  "account deletion preserves the shared referenced registry, nullable authors and another workspace",
  async () => {
    const admin = connect(urls.admin), sql = connect(urls.direct);
    const own = await businessWorkspaceFixture(admin, sql), other = await businessWorkspaceFixture(admin, sql);
    const issuers = { uow: new SqlEntityIssuerUnitOfWork(sql) },
      types = { uow: new SqlEntityTypeUnitOfWork(sql) },
      entities = { uow: new SqlEntityUnitOfWork(sql) };
    try {
      const type = await createEntityType(types, requestActor(own.manager), { label: "삭제 대상" });
      const preserved = await createEntityType(types, requestActor(other.manager), { label: "보존 대상" });
      await own.grantKind(own.manager, type.id, "write");
      await own.grant(own.member, [{ target_kind: "settings", target_id: "*", access: "write" }, {
        target_kind: "entity_type",
        target_id: type.id,
        access: "write",
      }]);
      const source = await createEntityIssuer(issuers, requestActor(own.manager), { code: "market", label: "마켓" });
      const rule = await createIdentifierRule(issuers, requestActor(own.manager), source.code, {
        label: "상품 번호",
        meaning: "마켓 상품 번호",
      });
      const configured = await configureIdentifierField(sql, own.manager, type.id, {
        allowed_kind_ids: [APP_IDENTIFIER_RULE_ID, rule.id],
        default_kind_id: rule.id,
      });
      const entity = await createEntity(entities, requestActor(own.manager), {
        ...configured.schema,
        properties: { prop_1: "상품", prop_2: encodeIdentifierValue(rule.id, "001A:B") },
      });
      await deleteEntity(entities, requestActor(own.manager), entity.id, entity.version);
      const tables = [
        "entity_issuers",
        "entity_identifier_rules",
        "entity_types",
        "entities",
        "records",
      ];
      const snapshot = async () => {
        const counts: Record<string, number> = {};
        for (const table of tables) {
          counts[table] =
            (await admin`select count(*)::int n from ${admin(`app.${table}`)} where workspace_id=${own.workspaceId}`)[0]
              .n;
        }
        return counts;
      };
      const before = await snapshot();
      const authors =
        await admin`select id,created_by_name from app.records where workspace_id=${own.workspaceId} order by id`;
      await admin`delete from auth.users where id=${own.manager.userId}`;
      assertEquals(await snapshot(), before);
      assertEquals((await getEntity(entities, own.member, entity.id)).deleted_at !== null, true);
      assertEquals((await getEntityType(types, own.member, type.id)).id, type.id);
      assertEquals(
        await admin`select id,created_by_name from app.records where workspace_id=${own.workspaceId} order by id`,
        authors,
      );
      assertEquals(
        (await admin`select count(*)::int n from app.records where workspace_id=${own.workspaceId} and created_by is not null`)[
          0
        ].n,
        0,
      );
      assertEquals((await getEntityType(types, other.manager, preserved.id)).id, preserved.id);
      assertEquals((await listEntityIssuers(issuers, other.manager)).items.map((value) => value.code), ["app"]);
    } finally {
      await own.cleanup();
      await other.cleanup();
      await sql.end();
      await admin.end();
    }
  },
);

import { deleteEntityIssuer, deleteIdentifierRule } from "../../functions/_shared/core/entity-issuers/application.ts";
dbTest("unused issuer cleanup preserves system, all linked kinds, workspace isolation and replay", async () => {
  const admin = connect(urls.admin), sql = connect(urls.direct);
  const a = await businessWorkspaceFixture(admin, sql), b = await businessWorkspaceFixture(admin, sql);
  const d = { uow: new SqlEntityIssuerUnitOfWork(sql) }, types = { uow: new SqlEntityTypeUnitOfWork(sql) };
  try {
    const type = await createEntityType(types, requestActor(a.manager), { label: "정리 검사" });
    await a.grantKind(a.manager, type.id, "write");
    const source = await createEntityIssuer(d, requestActor(a.manager), { code: "unused", label: "오등록" });
    const rule = await createIdentifierRule(d, requestActor(a.manager), source.code, {
      label: "번호",
      meaning: "번호",
    });
    assertEquals(
      (await assertRejects(
        () => deleteEntityIssuer(d, requestActor(b.manager), source.code, { expected_version: 1 }),
        AppError,
      )).code,
      "not_found",
    );
    assertEquals(
      (await assertRejects(
        () => deleteIdentifierRule(d, requestActor(b.manager), rule.id, { expected_version: 1 }),
        AppError,
      )).code,
      "not_found",
    );
    assertEquals(
      (await assertRejects(
        () => deleteEntityIssuer(d, requestActor(a.manager), source.code, { expected_version: 1 }),
        AppError,
      )).code,
      "invalid_input",
    );
    await configureIdentifierField(sql, a.manager, type.id, {
      allowed_kind_ids: [APP_IDENTIFIER_RULE_ID, rule.id],
      default_kind_id: APP_IDENTIFIER_RULE_ID,
    });
    assertEquals(
      (await assertRejects(
        () => deleteIdentifierRule(d, requestActor(a.manager), rule.id, { expected_version: 1 }),
        AppError,
      )).code,
      "invalid_input",
    );
    await assertRejects(() =>
      asSettings(sql, a.manager, (tx) => tx`delete from app.entity_identifier_rules where id=${rule.id}::uuid`)
    );
    await configureIdentifierField(sql, a.manager, type.id, {
      allowed_kind_ids: [APP_IDENTIFIER_RULE_ID],
      default_kind_id: APP_IDENTIFIER_RULE_ID,
    });
    // Historical definitions retain the original kind meaning even after the current field unlinks it.
    assertEquals(
      (await assertRejects(
        () => deleteIdentifierRule(d, requestActor(a.manager), rule.id, { expected_version: 1 }),
        AppError,
      )).code,
      "invalid_input",
    );
    const unusedSource = await createEntityIssuer(d, requestActor(a.manager), {
      code: "never_linked",
      label: "미사용",
    });
    const unusedRule = await createIdentifierRule(d, requestActor(a.manager), unusedSource.code, {
      label: "미사용 번호",
      meaning: "미사용 번호",
    });
    const writer = requestActor(a.manager);
    assertEquals(await deleteIdentifierRule(d, writer, unusedRule.id, { expected_version: 1 }), { deleted: true });
    assertEquals(await deleteIdentifierRule(d, writer, unusedRule.id, { expected_version: 1 }), { deleted: true });
    assertEquals(await deleteEntityIssuer(d, requestActor(a.manager), unusedSource.code, { expected_version: 1 }), {
      deleted: true,
    });
    await asSettings(sql, a.manager, async (tx) => {
      assertEquals((await tx`delete from app.entity_issuers where code='app' returning code`).length, 0);
      assertEquals((await tx`delete from app.entity_identifier_rules where source='app' returning id`).length, 0);
    });
    assertEquals((await listEntityIssuers(d, a.manager)).items.map((i) => i.code), ["app", "unused"]);
  } finally {
    await a.cleanup();
    await b.cleanup();
    await sql.end();
    await admin.end();
  }
});

dbTest(
  "active type names reject new duplicates and restore collisions without rewriting legacy duplicates",
  async () => {
    const admin = connect(urls.admin), sql = connect(urls.direct, { max: 3 });
    const a = await businessWorkspaceFixture(admin, sql);
    const d = { uow: new SqlEntityTypeUnitOfWork(sql) };
    try {
      const races = await Promise.allSettled(
        [1, 2].map(() => createEntityType(d, requestActor(a.manager), { label: "상품" })),
      );
      assertEquals(races.filter((r) => r.status === "fulfilled").length, 1);
      const rejected = races.find((r) => r.status === "rejected") as PromiseRejectedResult;
      assertEquals((rejected.reason as AppError).code, "invalid_input");
      const second = await createEntityType(d, requestActor(a.manager), { label: "주문" });
      await admin.begin(async (tx) => {
        await tx`select set_config('request.workspace_id',${a.workspaceId},true)`;
        await tx`insert into app.entity_schema_versions(workspace_id,schema) select workspace_id,schema||'{"x-version":2,"title":"상품"}'::jsonb from app.entity_schema_versions where workspace_id=${a.workspaceId} and type_id=${second.id} and schema_version=1`;
        await tx`update app.entity_types set schema_version=2 where workspace_id=${a.workspaceId} and id=${second.id}`;
      });
      const { updateEntityType } = await import("../../functions/_shared/core/entity-types/application.ts");
      const changed = await updateEntityType(d, requestActor(a.manager), second.id, {
        label: "상품",
        icon_id: "star",
        expected_schema_version: 2,
      });
      assertEquals(changed.label, "상품");
      const archived = await updateEntityType(d, requestActor(a.manager), second.id, {
        archived: true,
        expected_schema_version: changed.schema_version,
      });
      assertEquals(
        (await assertRejects(() =>
          updateEntityType(d, requestActor(a.manager), second.id, {
            archived: false,
            expected_schema_version: archived.schema_version,
          }), AppError)).code,
        "invalid_input",
      );
      const restored = await updateEntityType(d, requestActor(a.manager), second.id, {
        label: "다른 상품",
        archived: false,
        expected_schema_version: archived.schema_version,
      });
      assertEquals(restored.archived, false);
    } finally {
      await a.cleanup();
      await sql.end();
      await admin.end();
    }
  },
);

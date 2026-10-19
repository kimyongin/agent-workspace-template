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
  getEntityTypeIdentity,
  listEntityIssuers,
  listIdentifierRules,
  updateEntityIssuer,
  updateEntityTypeIdentity,
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
  "issuer registry: type defaults, rule reuse, workspace boundaries, disable and concurrent settings",
  async () => {
    const admin = connect(urls.admin), sql = connect(urls.direct, { max: 3 });
    const a = await businessWorkspaceFixture(admin, sql), b = await businessWorkspaceFixture(admin, sql);
    const d = { uow: new SqlEntityIssuerUnitOfWork(sql) }, types = { uow: new SqlEntityTypeUnitOfWork(sql) };
    try {
      const product = await createEntityType(types, requestActor(a.manager), { label: "상품" }),
        order = await createEntityType(types, requestActor(a.manager), { label: "주문" });
      await a.grantKind(a.manager, product.id, "write");
      await a.grantKind(a.manager, order.id, "write");
      const initial = await getEntityTypeIdentity(d, a.manager, product.id);
      assertEquals(initial, {
        type_id: product.id,
        label: "번호",
        default_source: "app",
        version: 1,
        sources: [{
          code: "app",
          rule_id: APP_IDENTIFIER_RULE_ID,
          active: true,
          referenced: false,
          source_label: "앱",
          rule_label: "자동 발급",
          generation: "automatic",
        }],
      });
      assertEquals((await getEntityType(types, a.manager, product.id)).identity, initial);
      const source = await createEntityIssuer(d, requestActor(a.manager), { code: "coupang", label: "쿠팡" });
      const rule = await createIdentifierRule(d, requestActor(a.manager), "coupang", {
        label: "상품 ID",
        meaning: "쿠팡의 상품 한 등록 건",
      });
      assertEquals(rule.generation, "direct");
      const sources = [...initial.sources.map(({ code, rule_id, active }) => ({ code, rule_id, active })), {
        code: "coupang",
        rule_id: rule.id,
        active: true,
      }];
      const payload = { label: "상품 번호", default_source: "coupang", sources, expected_version: 1 };
      const writer = requestActor(a.manager), saved = await updateEntityTypeIdentity(d, writer, product.id, payload);
      assertEquals(await updateEntityTypeIdentity(d, writer, product.id, payload), saved);
      await updateEntityTypeIdentity(d, requestActor(a.manager), order.id, { ...payload, label: "주문 번호" });
      assertEquals((await listIdentifierRules(d, a.manager, "coupang")).items.map((r) => r.id), [rule.id]);
      assertEquals((await listEntityIssuers(d, b.manager)).items, []);
      assertEquals(
        (await assertRejects(() => getEntityTypeIdentity(d, b.manager, product.id), AppError)).code,
        "not_found",
      );
      await assertRejects(() =>
        asSettings(sql, b.manager, async (tx) => {
          await tx`insert into app.entity_type_identity_sources(workspace_id,type_id,code,rule_id) values(${b.workspaceId},${product.id},'coupang',${rule.id})`;
        })
      );
      assertEquals(
        (await assertRejects(() => updateEntityTypeIdentity(d, requestActor(a.manager), product.id, payload), AppError))
          .code,
        "settings_changed",
      );
      const races = await Promise.allSettled(
        ["상품 번호 A", "상품 번호 B"].map((label) =>
          updateEntityTypeIdentity(d, requestActor(a.manager), product.id, { ...payload, label, expected_version: 2 })
        ),
      );
      assertEquals(races.filter((r) => r.status === "fulfilled").length, 1);
      assertEquals(
        (await assertRejects(
          () =>
            updateEntityIssuer(d, requestActor(a.manager), "coupang", {
              expected_version: source.version,
              active: false,
            }),
          AppError,
        )).code,
        "invalid_input",
      );
      assertEquals(
        (await assertRejects(
          () => updateIdentifierRule(d, requestActor(a.manager), rule.id, { expected_version: 1, active: false }),
          AppError,
        ))
          .code,
        "invalid_input",
      );
      const latest = await getEntityTypeIdentity(d, a.manager, product.id);
      for (const [id, expected_version] of [[product.id, latest.version], [order.id, 2]] as const) {
        await updateEntityTypeIdentity(d, requestActor(a.manager), id, {
          ...payload,
          default_source: "app",
          sources: sources.map((s) => ({ ...s, active: s.code === "app" })),
          expected_version,
        });
      }
      const beforeDisable = await getEntityTypeIdentity(d, a.manager, product.id);
      await updateIdentifierRule(d, requestActor(a.manager), rule.id, { expected_version: 1, active: false });
      assertEquals((await getEntityTypeIdentity(d, a.manager, product.id)).version, beforeDisable.version + 1);
      assertEquals(
        (await getEntityTypeIdentity(d, a.manager, product.id)).sources.find((s) => s.code === "coupang")?.active,
        false,
      );
      await updateEntityIssuer(d, requestActor(a.manager), "coupang", {
        expected_version: source.version,
        active: false,
      });
      assertEquals((await listEntityIssuers(d, a.manager)).items.find((s) => s.code === "coupang")?.active, false);
    } finally {
      await a.cleanup();
      await b.cleanup();
      await sql.end();
      await admin.end();
    }
  },
);

// Requires the integrated #428 entity creation contract; do not run against the old owner-wide settings contract.
dbTest("issuer registry: deleted entities retain rule meaning and type-source mapping references", async () => {
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
    const sources = [{ code: "app", rule_id: APP_IDENTIFIER_RULE_ID, active: true }, {
      code: "coupang",
      rule_id: rule.id,
      active: true,
    }];
    const identity = await updateEntityTypeIdentity(d, requestActor(a.manager), type.id, {
      label: "상품 번호",
      default_source: "app",
      expected_version: 1,
      sources,
    });
    const registration = {
      entity_type_id: type.id,
      schema_version: 1,
      source: "coupang",
      external_id: "00123",
      identity_version: identity.version,
      properties: { prop_1: "운동화" },
    };
    const entity = await createEntity(entities, requestActor(a.manager), registration);
    await deleteEntity(entities, requestActor(a.manager), entity.id, entity.version);
    assertEquals(
      (await assertRejects(
        () => deleteIdentifierRule(d, requestActor(a.manager), rule.id, { expected_version: 1 }),
        AppError,
      )).code,
      "invalid_input",
    );
    assertEquals(
      (await assertRejects(
        () => deleteEntityIssuer(d, requestActor(a.manager), "coupang", { expected_version: 1 }),
        AppError,
      )).code,
      "invalid_input",
    );
    assertEquals(
      (await assertRejects(
        () =>
          updateIdentifierRule(d, requestActor(a.manager), rule.id, { meaning: "다른 번호 의미", expected_version: 1 }),
        AppError,
      )).code,
      "invalid_input",
    );
    assertEquals(
      (await assertRejects(() =>
        updateEntityTypeIdentity(d, requestActor(a.manager), type.id, {
          label: "상품 번호",
          default_source: "app",
          expected_version: identity.version,
          sources: [sources[0], { ...sources[1], rule_id: alternative.id }],
        }), AppError)).code,
      "invalid_input",
    );
    assertEquals(
      (await assertRejects(() =>
        updateEntityTypeIdentity(d, requestActor(a.manager), type.id, {
          label: "상품 번호",
          default_source: "app",
          expected_version: identity.version,
          sources: [sources[0]],
        }), AppError)).code,
      "invalid_input",
    );
    const disabled = await updateEntityTypeIdentity(d, requestActor(a.manager), type.id, {
      label: "상품 번호",
      default_source: "app",
      expected_version: identity.version,
      sources: sources.map((s) => ({ ...s, active: s.code === "app" })),
    });
    assertEquals(disabled.sources.find((s) => s.code === "coupang")?.active, false);
    await updateIdentifierRule(d, requestActor(a.manager), rule.id, { label: "외부 상품 번호", expected_version: 1 });
    await assertRejects(() =>
      asSettings(sql, a.manager, async (tx) => {
        await tx`update app.entity_identifier_rules set meaning='우회' where id=${rule.id}`;
      })
    );
    await assertRejects(() =>
      asSettings(sql, a.manager, async (tx) => {
        await tx`delete from app.entity_type_identity_sources where type_id=${type.id} and code='coupang'`;
      })
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
      const identity = await getEntityTypeIdentity(issuers, own.manager, type.id);
      await updateEntityTypeIdentity(issuers, requestActor(own.manager), type.id, {
        label: "상품 번호",
        default_source: "market",
        expected_version: identity.version,
        sources: [...identity.sources.map(({ code, rule_id, active }) => ({ code, rule_id, active })), {
          code: "market",
          rule_id: rule.id,
          active: true,
        }],
      });
      const entity = await createEntity(entities, requestActor(own.manager), {
        entity_type_id: type.id,
        schema_version: 1,
        source: "market",
        external_id: "001A:B",
        properties: { prop_1: "상품" },
      });
      await deleteEntity(entities, requestActor(own.manager), entity.id, entity.version);
      const tables = [
        "entity_issuers",
        "entity_identifier_rules",
        "entity_type_identity",
        "entity_type_identity_sources",
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
    const identity = await getEntityTypeIdentity(d, a.manager, type.id);
    await updateEntityTypeIdentity(d, requestActor(a.manager), type.id, {
      label: identity.label,
      default_source: "app",
      expected_version: identity.version,
      sources: [...identity.sources.map(({ code, rule_id, active }) => ({ code, rule_id, active })), {
        code: source.code,
        rule_id: rule.id,
        active: false,
      }],
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
    const linked = await getEntityTypeIdentity(d, a.manager, type.id);
    await updateEntityTypeIdentity(d, requestActor(a.manager), type.id, {
      label: linked.label,
      default_source: "app",
      expected_version: linked.version,
      sources: linked.sources.filter((s) => s.code === "app").map(({ code, rule_id, active }) => ({
        code,
        rule_id,
        active,
      })),
    });
    const writer = requestActor(a.manager);
    assertEquals(await deleteIdentifierRule(d, writer, rule.id, { expected_version: 1 }), { deleted: true });
    assertEquals(await deleteIdentifierRule(d, writer, rule.id, { expected_version: 1 }), { deleted: true });
    assertEquals(await deleteEntityIssuer(d, requestActor(a.manager), source.code, { expected_version: 1 }), {
      deleted: true,
    });
    await asSettings(sql, a.manager, async (tx) => {
      assertEquals((await tx`delete from app.entity_issuers where code='app' returning code`).length, 0);
      assertEquals((await tx`delete from app.entity_identifier_rules where source='app' returning id`).length, 0);
    });
    assertEquals((await listEntityIssuers(d, a.manager)).items.map((i) => i.code), ["app"]);
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

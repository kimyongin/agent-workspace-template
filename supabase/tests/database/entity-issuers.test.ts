import { SqlEntityUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-store.ts";
import { createEntity, deleteEntity } from "../../functions/_shared/core/entity/application.ts";
import { assertEquals, assertRejects } from "@std/assert";
import { asUser, connect, dbTest, fixtureOwner, urls } from "./_db.ts";
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
dbTest("issuer registry: type defaults, rule reuse, owner boundaries, disable and concurrent settings", async () => {
  const admin = connect(urls.admin), sql = connect(urls.direct, { max: 3 });
  const a = await fixtureOwner(admin), b = await fixtureOwner(admin);
  const d = { uow: new SqlEntityIssuerUnitOfWork(sql) }, types = { uow: new SqlEntityTypeUnitOfWork(sql) };
  try {
    const product = await createEntityType(types, requestActor(a.actor), { label: "상품" }),
      order = await createEntityType(types, requestActor(a.actor), { label: "주문" });
    const initial = await getEntityTypeIdentity(d, a.actor, product.id);
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
    assertEquals((await getEntityType(types, a.actor, product.id)).identity, initial);
    const source = await createEntityIssuer(d, requestActor(a.actor), { code: "coupang", label: "쿠팡" });
    const rule = await createIdentifierRule(d, requestActor(a.actor), "coupang", {
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
    const writer = requestActor(a.actor), saved = await updateEntityTypeIdentity(d, writer, product.id, payload);
    assertEquals(await updateEntityTypeIdentity(d, writer, product.id, payload), saved);
    await updateEntityTypeIdentity(d, requestActor(a.actor), order.id, { ...payload, label: "주문 번호" });
    assertEquals((await listIdentifierRules(d, a.actor, "coupang")).items.map((r) => r.id), [rule.id]);
    assertEquals((await listEntityIssuers(d, b.actor)).items, []);
    assertEquals(
      (await assertRejects(() => getEntityTypeIdentity(d, b.actor, product.id), AppError)).code,
      "not_found",
    );
    await assertRejects(() =>
      asUser(sql, b.actor.userId, async (tx) => {
        await tx`insert into app.entity_type_identity_sources(owner_id,type_id,code,rule_id) values(${b.actor.userId},${product.id},'coupang',${rule.id})`;
      })
    );
    assertEquals(
      (await assertRejects(() => updateEntityTypeIdentity(d, requestActor(a.actor), product.id, payload), AppError))
        .code,
      "settings_changed",
    );
    const races = await Promise.allSettled(
      ["상품 번호 A", "상품 번호 B"].map((label) =>
        updateEntityTypeIdentity(d, requestActor(a.actor), product.id, { ...payload, label, expected_version: 2 })
      ),
    );
    assertEquals(races.filter((r) => r.status === "fulfilled").length, 1);
    assertEquals(
      (await assertRejects(
        () =>
          updateEntityIssuer(d, requestActor(a.actor), "coupang", { expected_version: source.version, active: false }),
        AppError,
      )).code,
      "conflict",
    );
    assertEquals(
      (await assertRejects(
        () => updateIdentifierRule(d, requestActor(a.actor), rule.id, { expected_version: 1, active: false }),
        AppError,
      ))
        .code,
      "conflict",
    );
    const latest = await getEntityTypeIdentity(d, a.actor, product.id);
    for (const [id, expected_version] of [[product.id, latest.version], [order.id, 2]] as const) {
      await updateEntityTypeIdentity(d, requestActor(a.actor), id, {
        ...payload,
        default_source: "app",
        sources: sources.map((s) => ({ ...s, active: s.code === "app" })),
        expected_version,
      });
    }
    const beforeDisable = await getEntityTypeIdentity(d, a.actor, product.id);
    await updateIdentifierRule(d, requestActor(a.actor), rule.id, { expected_version: 1, active: false });
    assertEquals((await getEntityTypeIdentity(d, a.actor, product.id)).version, beforeDisable.version + 1);
    assertEquals(
      (await getEntityTypeIdentity(d, a.actor, product.id)).sources.find((s) => s.code === "coupang")?.active,
      false,
    );
    await updateEntityIssuer(d, requestActor(a.actor), "coupang", { expected_version: source.version, active: false });
    assertEquals((await listEntityIssuers(d, a.actor)).items.find((s) => s.code === "coupang")?.active, false);
  } finally {
    await a.cleanup();
    await b.cleanup();
    await sql.end();
    await admin.end();
  }
});

// Requires the integrated #428 entity creation contract; do not run against the old owner-wide settings contract.
dbTest("issuer registry: deleted entities retain rule meaning and type-source mapping references", async () => {
  const admin = connect(urls.admin), sql = connect(urls.direct);
  const a = await fixtureOwner(admin);
  const d = { uow: new SqlEntityIssuerUnitOfWork(sql) },
    types = { uow: new SqlEntityTypeUnitOfWork(sql) },
    entities = { uow: new SqlEntityUnitOfWork(sql) };
  try {
    const type = await createEntityType(types, requestActor(a.actor), { label: "상품" });
    await createEntityIssuer(d, requestActor(a.actor), { code: "coupang", label: "쿠팡" });
    const rule = await createIdentifierRule(d, requestActor(a.actor), "coupang", {
      label: "상품 ID",
      meaning: "쿠팡 상품 등록 ID",
    });
    const alternative = await createIdentifierRule(d, requestActor(a.actor), "coupang", {
      label: "판매자 번호",
      meaning: "판매자 상품 번호",
    });
    const sources = [{ code: "app", rule_id: APP_IDENTIFIER_RULE_ID, active: true }, {
      code: "coupang",
      rule_id: rule.id,
      active: true,
    }];
    const identity = await updateEntityTypeIdentity(d, requestActor(a.actor), type.id, {
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
    const entity = await createEntity(entities, requestActor(a.actor), registration);
    await deleteEntity(entities, requestActor(a.actor), entity.id, entity.version);
    assertEquals(
      (await assertRejects(
        () =>
          updateIdentifierRule(d, requestActor(a.actor), rule.id, { meaning: "다른 번호 의미", expected_version: 1 }),
        AppError,
      )).code,
      "invalid_input",
    );
    assertEquals(
      (await assertRejects(() =>
        updateEntityTypeIdentity(d, requestActor(a.actor), type.id, {
          label: "상품 번호",
          default_source: "app",
          expected_version: identity.version,
          sources: [sources[0], { ...sources[1], rule_id: alternative.id }],
        }), AppError)).code,
      "invalid_input",
    );
    assertEquals(
      (await assertRejects(() =>
        updateEntityTypeIdentity(d, requestActor(a.actor), type.id, {
          label: "상품 번호",
          default_source: "app",
          expected_version: identity.version,
          sources: [sources[0]],
        }), AppError)).code,
      "invalid_input",
    );
    const disabled = await updateEntityTypeIdentity(d, requestActor(a.actor), type.id, {
      label: "상품 번호",
      default_source: "app",
      expected_version: identity.version,
      sources: sources.map((s) => ({ ...s, active: s.code === "app" })),
    });
    assertEquals(disabled.sources.find((s) => s.code === "coupang")?.active, false);
    await updateIdentifierRule(d, requestActor(a.actor), rule.id, { label: "외부 상품 번호", expected_version: 1 });
    await assertRejects(() =>
      asUser(sql, a.actor.userId, async (tx) => {
        await tx`update app.entity_identifier_rules set meaning='우회' where id=${rule.id}`;
      })
    );
    await assertRejects(() =>
      asUser(sql, a.actor.userId, async (tx) => {
        await tx`delete from app.entity_type_identity_sources where type_id=${type.id} and code='coupang'`;
      })
    );
  } finally {
    await a.cleanup();
    await sql.end();
    await admin.end();
  }
});

dbTest("account deletion cascades the complete referenced registry while preserving another owner", async () => {
  const admin = connect(urls.admin), sql = connect(urls.direct);
  const own = await fixtureOwner(admin), other = await fixtureOwner(admin);
  const issuers = { uow: new SqlEntityIssuerUnitOfWork(sql) },
    types = { uow: new SqlEntityTypeUnitOfWork(sql) },
    entities = { uow: new SqlEntityUnitOfWork(sql) };
  try {
    const type = await createEntityType(types, requestActor(own.actor), { label: "삭제 대상" });
    const preserved = await createEntityType(types, requestActor(other.actor), { label: "보존 대상" });
    const source = await createEntityIssuer(issuers, requestActor(own.actor), { code: "market", label: "마켓" });
    const rule = await createIdentifierRule(issuers, requestActor(own.actor), source.code, {
      label: "상품 번호",
      meaning: "마켓 상품 번호",
    });
    const identity = await getEntityTypeIdentity(issuers, own.actor, type.id);
    await updateEntityTypeIdentity(issuers, requestActor(own.actor), type.id, {
      label: "상품 번호",
      default_source: "market",
      expected_version: identity.version,
      sources: [...identity.sources.map(({ code, rule_id, active }) => ({ code, rule_id, active })), {
        code: "market",
        rule_id: rule.id,
        active: true,
      }],
    });
    const entity = await createEntity(entities, requestActor(own.actor), {
      entity_type_id: type.id,
      schema_version: 1,
      source: "market",
      external_id: "001A:B",
      properties: { prop_1: "상품" },
    });
    await deleteEntity(entities, requestActor(own.actor), entity.id, entity.version);
    await admin`delete from auth.users where id=${own.actor.userId}`;
    for (
      const table of [
        "entity_issuers",
        "entity_identifier_rules",
        "entity_type_identity",
        "entity_type_identity_sources",
        "entity_types",
        "entities",
        "records",
      ]
    ) {
      assertEquals(
        (await admin`select count(*)::int n from ${admin(`app.${table}`)} where owner_id=${own.actor.userId}`)[0].n,
        0,
      );
    }
    assertEquals((await getEntityType(types, other.actor, preserved.id)).id, preserved.id);
    assertEquals((await listEntityIssuers(issuers, other.actor)).items.map((value) => value.code), ["app"]);
  } finally {
    await own.cleanup();
    await other.cleanup();
    await sql.end();
    await admin.end();
  }
});

import { assertEquals, assertRejects } from "@std/assert";
import { connect, urls } from "./_db.ts";
import { businessRequest, businessWorkspaceFixture } from "./_workspace-business.ts";
import { SqlEntityIssuerUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-issuer-store.ts";
import {
  createEntityIssuer,
  createIdentifierRule,
  listEntityIssuers,
} from "../../functions/_shared/core/entity-issuers/application.ts";
import { getEntitySchema } from "../../functions/_shared/core/entity-types/application.ts";
import { runInWorkspace } from "../../functions/_shared/adapters/supabase/workspace-context.ts";
import { APP_IDENTIFIER_RULE_ID } from "../../functions/_shared/contracts/entity-issuer.ts";
import { AppError } from "../../functions/_shared/core/shared/errors.ts";

Deno.test("schema identifier metadata respects settings readers, exact type readers, workspace isolation and revoked grants", async () => {
  const admin = connect(urls.admin), sql = connect(urls.pooler, { max: 3, prepare: false });
  const fixture = await businessWorkspaceFixture(admin, sql), other = await businessWorkspaceFixture(admin, sql);
  const issuers = { uow: new SqlEntityIssuerUnitOfWork(sql) };
  try {
    const type = await fixture.createKind("설정에서 읽는 자료"), hidden = await fixture.createKind("별도 업무 권한");
    const source = await createEntityIssuer(issuers, businessRequest(fixture.manager), {
      code: "unattached",
      label: "연결되지 않은 발급처",
    });
    const unrelated = await createIdentifierRule(issuers, businessRequest(fixture.manager), source.code, {
      label: "연결되지 않은 종류",
      meaning: "연결되지 않은 종류",
    });
    // Creating/configuring a kind gives no implicit business grant to its manager.
    const managerRead = await getEntitySchema(fixture.typeDeps, fixture.manager, { type_id: type.id });
    assertEquals(managerRead.identifier_kinds?.map((kind) => kind.id), [APP_IDENTIFIER_RULE_ID]);
    assertEquals(
      managerRead.identity_change_allowed,
      false,
      "settings authority cannot infer emptiness without type read",
    );
    await fixture.grant(fixture.member, [{ target_kind: "settings", target_id: "*", access: "read" }]);
    const settingsRead = await getEntitySchema(fixture.typeDeps, fixture.member, { type_id: type.id });
    assertEquals(settingsRead.schema, managerRead.schema);
    assertEquals(settingsRead.identity_change_allowed, false);
    assertEquals(settingsRead.identifier_kinds?.map((kind) => kind.id), [APP_IDENTIFIER_RULE_ID]);
    assertEquals(settingsRead.identifier_kinds?.some((kind) => kind.id === unrelated.id), false);
    await fixture.grant(fixture.member, [{ target_kind: "entity_type", target_id: type.id, access: "read" }]);
    const typeRead = await getEntitySchema(fixture.typeDeps, fixture.member, { type_id: type.id });
    assertEquals(typeRead.identifier_kinds, settingsRead.identifier_kinds);
    assertEquals(typeRead.identity_change_allowed, true, "the explicitly readable kind is empty");
    assertEquals((await assertRejects(() => listEntityIssuers(issuers, fixture.member), AppError)).code, "forbidden");
    assertEquals(
      (await assertRejects(() => getEntitySchema(fixture.typeDeps, fixture.member, { type_id: hidden.id }), AppError))
        .code,
      "not_found",
    );
    assertEquals(
      (await assertRejects(() => getEntitySchema(other.typeDeps, other.manager, { type_id: type.id }), AppError)).code,
      "not_found",
    );
    const foreignMetadata = await runInWorkspace(
      sql,
      other.manager,
      { mode: "business", requirements: [] },
      async (tx) => (await tx`select app.entity_identifier_kinds(${type.id}::uuid,1) as kinds`)[0].kinds,
    );
    assertEquals(foreignMetadata, []);
    await fixture.grant(fixture.member, []);
    for (const id of [type.id, crypto.randomUUID()]) {
      assertEquals(
        (await assertRejects(() => getEntitySchema(fixture.typeDeps, fixture.member, { type_id: id }), AppError)).code,
        "not_found",
      );
      assertEquals(
        (await assertRejects(
          () =>
            runInWorkspace(
              sql,
              fixture.member,
              { mode: "business", requirements: [] },
              async (tx) => await tx`select app.entity_identifier_kinds(${id}::uuid,1)`,
            ),
          AppError,
        )).code,
        "forbidden",
      );
    }
    assertEquals(
      (await assertRejects(
        () =>
          getEntitySchema(fixture.typeDeps, { ...fixture.member, workspaceId: other.workspaceId }, {
            type_id: type.id,
          }),
        AppError,
      )).code,
      "forbidden",
    );
  } finally {
    await fixture.cleanup();
    await other.cleanup();
    await sql.end();
    await admin.end();
  }
});

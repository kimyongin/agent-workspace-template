import { getEntitySchema } from "../../functions/_shared/core/entity-types/application.ts";
import {
  decodeIdentifierReference,
  encodeIdentifierReference,
  encodeIdentifierValue,
} from "../../functions/_shared/contracts/entity-identifiers.ts";
import { assert, assertEquals, assertRejects } from "@std/assert";
import * as entities from "../../functions/_shared/core/entity/application.ts";
import * as registry from "../../functions/_shared/core/entity-issuers/application.ts";
import { AppError } from "../../functions/_shared/core/shared/errors.ts";
import { entityCreate, type EntityUpdate, entityUpdate } from "../../functions/_shared/contracts/entity.ts";
import { SqlEntityUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-store.ts";
import { runInWorkspace } from "../../functions/_shared/adapters/supabase/workspace-context.ts";
import { businessRequest, businessWorkspaceFixture } from "./_workspace-business.ts";
import { configureIdentifierField, directEntitySource } from "./_entity.ts";
import { connect, dbTest, urls } from "./_db.ts";

const admin = connect(urls.admin, { max: 1 }), sql = connect(urls.direct, { max: 3, prepare: false });
const deps = { uow: new SqlEntityUnitOfWork(sql) };

// Public use cases establish all registry/business data. Administrative SQL is
// limited to owned fixture accounts, persisted facts and exact cleanup.
dbTest("workspace entity direct identities preserve exact tuples and shared history across lifecycle", async () => {
  const f = await businessWorkspaceFixture(admin, sql);
  try {
    const rawAuthor = `  공유 기록 작성자\n${"가".repeat(120)}  `;
    const savedAuthor = (`공유 기록 작성자 ${"가".repeat(120)}`).slice(0, 100);
    await admin`update auth.users set raw_user_meta_data=${
      admin.json({ full_name: rawAuthor })
    } where id=${f.member.userId}`;
    const kind = await f.createKind("직접 번호 자료");
    await f.grantKind(f.manager, kind.id, "write");
    await f.grantKind(f.member, kind.id, "write");
    const setup = await directEntitySource(sql, f.manager, kind.id);
    const other = await f.addWorkspace("다른 직접 번호 공간");
    const foreignKind = await f.createKind("다른 공간 자료", other.manager);
    await f.grantKind(other.manager, foreignKind.id, "write");
    await f.grantKind(other.member, foreignKind.id, "write");
    const foreignSetup = await directEntitySource(sql, other.manager, foreignKind.id);
    const foreignIssuer = await registry.createEntityIssuer(setup.deps, businessRequest(other.manager), {
      code: "foreign_only",
      label: "다른 공간 전용 발급처",
    });
    const foreignRule = await registry.createIdentifierRule(
      setup.deps,
      businessRequest(other.manager),
      foreignIssuer.code,
      {
        label: "다른 공간 번호",
        meaning: "다른 공간에만 있는 직접 번호",
      },
    );
    const current = await getEntitySchema(f.typeDeps, f.member, { type_id: kind.id });
    assertEquals(current, setup.definition, "kind writer reads field settings without settings grant");
    assertEquals(current.identifier_kinds?.find((kind) => kind.id === setup.rule.id)?.generation, "direct");
    assertEquals(
      (await assertRejects(() =>
        registry.createEntityIssuer(setup.deps, businessRequest(f.member), {
          code: "forbidden",
          label: "업무 권한으로 만들 수 없는 발급처",
        }), AppError)).code,
      "forbidden",
    );
    // Both a known foreign rule under the same code and a foreign-only issuer
    // must fail before a local assignment is replaced or added.
    for (const foreignKindId of [foreignSetup.rule.id, foreignRule.id]) {
      assertEquals(
        (await assertRejects(() =>
          configureIdentifierField(sql, f.manager, kind.id, {
            allowed_kind_ids: [setup.rule.id, foreignKindId],
            default_kind_id: setup.rule.id,
          }), AppError)).code,
        "invalid_input",
      );
    }
    assertEquals(await getEntitySchema(f.typeDeps, f.member, { type_id: kind.id }), current);
    const input = entityCreate.parse({
      entity_type_id: kind.id.toUpperCase(),
      schema_version: setup.schema.schema_version,
      properties: { prop_1: "보존할 원본", prop_2: encodeIdentifierValue(setup.rule.id, "000Ab:/한글%é") },
    });
    const request = businessRequest(f.member);
    const created = await entities.createEntity(deps, request, input);
    assertEquals([
      created.id,
      decodeIdentifierReference(created.id).kind_id,
      decodeIdentifierReference(created.id).raw,
      created.entity_type_id,
      created.version,
    ], [
      encodeIdentifierReference(kind.id, setup.rule.id, "000Ab:/한글%é"),
      setup.rule.id,
      "000Ab:/한글%é",
      kind.id,
      1,
    ]);
    assertEquals(await entities.createEntity(deps, request, input), created);
    assertEquals(
      (await assertRejects(() => entities.createEntity(deps, businessRequest(f.member), input), AppError)).code,
      "conflict",
    );
    assertEquals(
      (await assertRejects(
        () =>
          entities.createEntity(deps, request, {
            ...input,
            properties: { ...input.properties, prop_2: encodeIdentifierValue(setup.rule.id, "different") },
          }),
        AppError,
      )).code,
      "idempotency_key_reused",
    );
    assertEquals(
      (await assertRejects(() =>
        entities.createEntity(deps, businessRequest(f.member), {
          ...input,
          schema_version: current.schema_version - 1,
          properties: { ...input.properties, prop_2: encodeIdentifierValue(setup.rule.id, "stale-settings") },
        }), AppError)).code,
      "schema_changed",
    );
    assertEquals(
      (await assertRejects(() =>
        entities.createEntity(deps, businessRequest(f.member), {
          ...input,
          properties: { ...input.properties, prop_2: encodeIdentifierValue(foreignRule.id, "foreign-issuer") },
        }), AppError)).code,
      "invalid_input",
    );
    assertEquals(
      (await assertRejects(() =>
        entities.createEntity(deps, businessRequest(f.member), {
          ...input,
          entity_type_id: foreignKind.id,
        }), AppError)).code,
      "forbidden",
    );
    // Exact case, leading zeros, composed/decomposed Unicode and punctuation
    // are identities, not a normalization or integer conversion input.
    const siblings = [];
    for (const raw of ["000ab:/한글%é", "Ab:/한글%é", "000Ab:/한글%e\u0301"]) {
      const saved = await entities.createEntity(deps, businessRequest(f.member), {
        ...input,
        properties: { ...input.properties, prop_2: encodeIdentifierValue(setup.rule.id, raw) },
      });
      assertEquals([saved.id, decodeIdentifierReference(saved.id).raw], [
        encodeIdentifierReference(kind.id, setup.rule.id, raw),
        raw,
      ]);
      siblings.push(saved);
    }
    assertEquals(new Set([created.id, ...siblings.map((value) => value.id)]).size, 4);
    const parallel = await entities.createEntity(deps, businessRequest(other.member), {
      ...input,
      entity_type_id: foreignKind.id,
      schema_version: foreignSetup.schema.schema_version,
      properties: {
        ...input.properties,
        prop_2: encodeIdentifierValue(foreignSetup.rule.id, decodeIdentifierReference(created.id).raw),
      },
    });
    assertEquals([
      decodeIdentifierReference(parallel.id).kind_id,
      decodeIdentifierReference(parallel.id).raw,
      parallel.version,
    ], [foreignSetup.rule.id, decodeIdentifierReference(created.id).raw, 1]);
    assert(parallel.id !== created.id);
    assertEquals(
      (await assertRejects(() => entities.getEntity(deps, other.member, created.id), AppError)).code,
      "not_found",
    );
    assertEquals(
      (await assertRejects(() => entities.getEntity(deps, f.member, parallel.id), AppError)).code,
      "not_found",
    );
    for (
      const [field, value] of [["id", encodeIdentifierReference(kind.id, setup.rule.id, "replacement")], [
        "properties",
        { ...created.properties, prop_2: encodeIdentifierValue(setup.rule.id, "replacement") },
      ], [
        "entity_type_id",
        foreignKind.id,
      ]]
    ) {
      const invalid = {
        schema_version: setup.schema.schema_version,
        expected_version: 1,
        properties: { prop_1: "반영되면 안 되는 값" },
        [field as string]: value,
      } as EntityUpdate;
      assertEquals(
        (await assertRejects(
          () => entities.updateEntity(deps, businessRequest(f.member), created.id, invalid),
          AppError,
        )).code,
        field === "properties" ? "invalid_input" : "entity_type_immutable",
      );
      // Catch inside a savepoint to retain the raw guard's SQLSTATE/message;
      // runInWorkspace still establishes the real app_server -> app_user role.
      await runInWorkspace(sql, f.member, {
        mode: "business",
        requirements: [{ target_kind: "entity_type", target_id: kind.id, access: "write" }],
      }, async (tx) => {
        const rejected = await assertRejects(() =>
          tx.savepoint(async (nested) => {
            const rows = await nested`update app.entities set ${nested(field as string)}=${
              typeof value === "object" ? nested.json(value) : value
            } where workspace_id=${f.workspaceId} and id=${created.id} returning id`;
            assertEquals(rows.length, 1, "a zero-row update cannot establish the immutable identity guard");
          })
        );
        assertEquals((rejected as { code?: string }).code, "23514");
        assertEquals(
          (rejected as { message?: string }).message,
          field === "entity_type_id" ? "identifier_definition_missing" : "entity_identity_immutable",
        );
      });
    }
    const changed = await entities.updateEntity(
      deps,
      businessRequest(f.member),
      created.id,
      entityUpdate.parse({
        schema_version: setup.schema.schema_version,
        expected_version: 1,
        properties: { prop_1: "수정 후에도 같은 식별자" },
      }),
    );
    assertEquals([changed.id, decodeIdentifierReference(changed.id).raw, changed.version], [
      created.id,
      decodeIdentifierReference(created.id).raw,
      2,
    ]);
    assertEquals(
      (await assertRejects(() => entities.deleteEntity(deps, businessRequest(f.member), created.id, 1), AppError)).code,
      "conflict",
    );
    const deleteRequest = businessRequest(f.member);
    await entities.deleteEntity(deps, deleteRequest, created.id, 2);
    const deleted = await entities.getEntity(deps, f.manager, created.id);
    assert(deleted.deleted_at);
    assertEquals(deleted.version, 3);
    // A retained successful create receipt is not an implicit restore command.
    assertEquals(await entities.createEntity(deps, request, input), created);
    assertEquals((await entities.getEntity(deps, f.manager, created.id)).deleted_at, deleted.deleted_at);
    assertEquals(
      (await assertRejects(() => entities.createEntity(deps, businessRequest(f.member), input), AppError)).code,
      "conflict",
    );
    assertEquals(
      (await assertRejects(() =>
        entities.restoreEntity(deps, businessRequest(f.member), created.id, {
          schema_version: setup.schema.schema_version,
          expected_version: 2,
        }), AppError)).code,
      "conflict",
    );
    const restoreRequest = businessRequest(f.member);
    const restoreInput = { schema_version: setup.schema.schema_version, expected_version: 3 };
    const restored = await entities.restoreEntity(deps, restoreRequest, created.id, restoreInput);
    assertEquals(
      [
        restored.id,
        decodeIdentifierReference(restored.id).raw,
        restored.version,
        restored.deleted_at,
        restored.properties.prop_1,
      ],
      [
        created.id,
        decodeIdentifierReference(created.id).raw,
        4,
        null,
        changed.properties.prop_1,
      ],
    );
    assertEquals(await entities.restoreEntity(deps, restoreRequest, created.id, restoreInput), restored);
    await entities.deleteEntity(deps, deleteRequest, created.id, 2);
    assertEquals((await entities.getEntity(deps, f.manager, created.id)).version, 4);
    assertEquals(
      (await assertRejects(() =>
        entities.updateEntity(
          deps,
          businessRequest(f.member),
          created.id,
          entityUpdate.parse({
            schema_version: setup.schema.schema_version,
            expected_version: 3,
            properties: { prop_1: "오래된 수정" },
          }),
        ), AppError)).code,
      "conflict",
    );
    const history =
      await admin`select id,entity_id,task_id,owner_id,created_by,created_by_name,change_metadata->>'action' as action from app.records where workspace_id=${f.workspaceId} and entity_id=${created.id} order by created_at,id`;
    assertEquals(history.length, 4);
    assertEquals(history.map((row) => row.action), ["create", "update", "delete", "restore"]);
    for (const row of history) {
      assertEquals([row.entity_id, row.task_id, row.owner_id, row.created_by], [
        created.id,
        null,
        null,
        f.member.userId,
      ]);
      assertEquals(row.created_by_name, savedAuthor);
    }
    assertEquals((await entities.getEntity(deps, f.manager, created.id)).records.count, 4);
    const [stored] =
      await admin`select workspace_id,owner_id from app.entities where workspace_id=${f.workspaceId} and id=${created.id}`;
    assertEquals(stored, { workspace_id: f.workspaceId, owner_id: null });
    assertEquals(
      Number(
        (await admin`select count(*) n from app.entities where owner_id=any(${[
          f.manager.userId,
          f.member.userId,
        ]}::uuid[]) and workspace_id is null`)[0].n,
      ),
      0,
    );
    // Delete only this fixture's nonmanager initiator. The manager remains and
    // shared values/history survive; historical author snapshots are bounded.
    await admin`delete from auth.users where id=${f.member.userId}`;
    const surviving = await entities.getEntity(deps, f.manager, created.id);
    assertEquals([surviving.id, surviving.version, surviving.properties, surviving.records.count], [
      restored.id,
      4,
      restored.properties,
      4,
    ]);
    const survivingHistory =
      await admin`select id,created_by,created_by_name from app.records where workspace_id=${f.workspaceId} and entity_id=${created.id} order by created_at,id`;
    assertEquals(
      [...survivingHistory],
      history.map(({ id, created_by_name }) => ({ id, created_by: null, created_by_name })),
    );
    assertEquals(
      decodeIdentifierReference((await entities.getEntity(deps, other.manager, parallel.id)).id).raw,
      decodeIdentifierReference(created.id).raw,
    );
  } finally {
    await f.cleanup();
  }
});

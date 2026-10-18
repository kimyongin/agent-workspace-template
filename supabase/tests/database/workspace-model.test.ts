import {
  applyDataModel,
  exportDataModel,
  getDataModelChange,
  listDataModelChanges,
  prepareDataModel,
  previewDataModel,
} from "../../functions/_shared/core/data-model/application.ts";
import { dataModelPrepare } from "../../functions/_shared/contracts/data-model.ts";
import { requestIdentity } from "../../functions/_shared/core/shared/request.ts";
import { replayRetainedSqlRequest } from "../../functions/_shared/adapters/supabase/request-ledger.ts";
import { runInWorkspace } from "../../functions/_shared/adapters/supabase/workspace-context.ts";
import { listTags } from "../../functions/_shared/core/tags/application.ts";
import { SqlTagUnitOfWork } from "../../functions/_shared/adapters/supabase/tag-store.ts";
import { SqlDataModelUnitOfWork } from "../../functions/_shared/adapters/supabase/data-model-store.ts";
import * as issuers from "../../functions/_shared/core/entity-issuers/application.ts";
import { SqlEntityIssuerUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-issuer-store.ts";
import * as settings from "../../functions/_shared/core/settings/application.ts";
import { SqlBusinessSettingsUnitOfWork } from "../../functions/_shared/adapters/supabase/business-settings-store.ts";
import { assertEquals, assertRejects } from "@std/assert";
import { AppError } from "../../functions/_shared/core/shared/errors.ts";
import type { Actor } from "../../functions/_shared/core/shared/actor.ts";
import * as workspaces from "../../functions/_shared/core/workspaces/application.ts";
import * as types from "../../functions/_shared/core/entity-types/application.ts";
import { SqlWorkspaceUnitOfWork } from "../../functions/_shared/adapters/supabase/workspace-store.ts";
import { SqlEntityTypeUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-type-store.ts";
import { connect, dbTest, urls } from "./_db.ts";

const admin = connect(urls.admin, { max: 1 });
const sql = connect(urls.direct, { max: 5, prepare: false });
const workspaceDeps = { uow: new SqlWorkspaceUnitOfWork(sql) };
const typeDeps = { uow: new SqlEntityTypeUnitOfWork(sql) };
const key = (actor: Actor): Actor => ({ ...actor, request: { key: crypto.randomUUID() } });

dbTest(
  "workspace model creation isolates equal names, denies implicit creator data access and shares configuration",
  async () => {
    const a = { userId: crypto.randomUUID() }, b = { userId: crypto.randomUUID() };
    const owned: string[] = [];
    for (const actor of [a, b]) {
      const email = `model513-${actor.userId}@example.test`;
      await admin`insert into auth.users(id,email) values(${actor.userId},${email})`;
      await admin`insert into auth.identities(id,user_id,provider,provider_id,identity_data) values(${crypto.randomUUID()},${actor.userId},'google',${actor.userId},${
        admin.json({ sub: actor.userId, email, email_verified: true })
      })`;
    }
    try {
      for (const name of ["첫 공간", "다른 공간"]) {
        const created = await workspaces.createWorkspace(workspaceDeps, key(a), { name });
        owned.push(created.workspace.id);
      }
      const first = { ...a, workspaceId: owned[0] }, second = { ...a, workspaceId: owned[1] };
      const left = await types.createEntityType(typeDeps, key(first), { label: "자료" });
      const right = await types.createEntityType(typeDeps, key(second), { label: "자료" });
      assertEquals((await types.listEntityTypes(typeDeps, first)).items.map((v) => v.id), [left.id]);
      assertEquals((await types.listEntityTypes(typeDeps, second)).items.map((v) => v.id), [right.id]);
      assertEquals((await workspaces.workspaceDetails(workspaceDeps, a, owned[0])).grants, [
        { target_kind: "settings", target_id: "*", access: "write" },
      ]);
      const invitation = await workspaces.inviteWorkspaceMember(workspaceDeps, key(a), owned[0], {
        email: `model513-${b.userId}@example.test`,
        grants: [{ target_kind: "settings", target_id: "*", access: "read" }],
      });
      await workspaces.acceptWorkspaceInvitation(workspaceDeps, key(b), invitation.invitation.id);
      const reader = { ...b, workspaceId: owned[0] };
      assertEquals((await types.getEntityType(typeDeps, reader, left.id)).id, left.id);
      assertEquals((await types.getEntitySchema(typeDeps, reader, { type_id: left.id })).schema_version, 1);
      const modelDeps = { uow: new SqlDataModelUnitOfWork(sql) };
      assertEquals((await exportDataModel(modelDeps, reader)).entity_types.map((v) => v.schema["x-type-id"]), [
        left.id,
      ]);
      assertEquals((await exportDataModel(modelDeps, second)).entity_types.map((v) => v.schema["x-type-id"]), [
        right.id,
      ]);
      const exported = await exportDataModel(modelDeps, reader);
      const readonlyPreview = await assertRejects(() =>
        previewDataModel(modelDeps, reader, {
          mode: "copy",
          document: JSON.stringify(exported),
        }), AppError);
      assertEquals(readonlyPreview.code, "forbidden");
      const error = await assertRejects(
        () => types.createEntityType(typeDeps, key(reader), { label: "금지" }),
        AppError,
      );
      assertEquals(error.code, "forbidden");
      const wrong = await assertRejects(() => types.getEntityType(typeDeps, second, left.id), AppError);
      assertEquals(wrong.code, "not_found");
      await workspaces.updateWorkspaceMember(workspaceDeps, key(a), owned[0], b.userId, {
        expected_version: 1,
        grants: [{ target_kind: "settings", target_id: "*", access: "write" }],
      });
      const reviewInput = {
        mode: "copy",
        document: JSON.stringify({
          ...exported,
          relations: [{
            id: crypto.randomUUID(),
            version: 1,
            archived: false,
            ends: [
              { type_ref: exported.entity_types[0].ref, label: "상위", cardinality: "many" },
              { type_ref: exported.entity_types[0].ref, label: "하위", cardinality: "many" },
            ],
          }],
        }),
      };
      const [managerA, managerB] = await Promise.all([
        previewDataModel(modelDeps, first, reviewInput),
        previewDataModel(modelDeps, reader, reviewInput),
      ]);
      assertEquals(managerA.mapping, managerB.mapping);
      assertEquals(managerA.fingerprint, managerB.fingerprint);
      const prepared = await prepareDataModel(modelDeps, key(first), {
        ...reviewInput,
        preview_fingerprint: managerA.fingerprint,
      });
      assertEquals(prepared.status, "ready");
      assertEquals((await getDataModelChange(modelDeps, reader, prepared.id)).id, prepared.id);
      const secondPrepared = await prepareDataModel(modelDeps, key(first), {
        ...reviewInput,
        preview_fingerprint: managerA.fingerprint,
      });
      const secondReview = await previewDataModel(modelDeps, second, reviewInput);
      await prepareDataModel(modelDeps, key(second), { ...reviewInput, preview_fingerprint: secondReview.fingerprint });
      const page = await listDataModelChanges(modelDeps, first, { limit: 1 });
      assertEquals(page.items.length, 1);
      assertEquals(typeof page.next_cursor, "string");
      const rest = await listDataModelChanges(modelDeps, first, { limit: 1, cursor: page.next_cursor! });
      assertEquals(new Set([...page.items, ...rest.items].map((v) => v.id)), new Set([prepared.id, secondPrepared.id]));
      const crossed = await assertRejects(
        () => listDataModelChanges(modelDeps, second, { limit: 1, cursor: page.next_cursor! }),
        AppError,
      );
      assertEquals(crossed.code, "invalid_input");
      const wrongPlan = await assertRejects(() => getDataModelChange(modelDeps, second, prepared.id), AppError);
      assertEquals(wrongPlan.code, "not_found");
      assertEquals((await types.listEntityTypes(typeDeps, first)).items.map((v) => v.id), [left.id]);
      const applied = await applyDataModel(modelDeps, key(reader), prepared.id, {
        expected_version: prepared.version,
      });
      assertEquals(applied.status, "applied");
      assertEquals(
        (await exportDataModel(modelDeps, first)).relations.map((v) => v.id),
        Object.values(managerA.mapping.relations),
      );
      assertEquals(
        new Set((await exportDataModel(modelDeps, first)).entity_types.map((v) => v.schema["x-type-id"])),
        new Set([left.id, ...Object.values(managerA.mapping.types)]),
      );
      assertEquals((await exportDataModel(modelDeps, second)).entity_types.map((v) => v.schema["x-type-id"]), [
        right.id,
      ]);
      assertEquals((await workspaces.workspaceDetails(workspaceDeps, b, owned[0])).grants, [
        { target_kind: "settings", target_id: "*", access: "write" },
      ]);
      const metadataOnly = await exportDataModel(modelDeps, reader);
      metadataOnly.entity_types.find((v) => v.schema["x-type-id"] === left.id)!.schema.title = "자료 이름 변경";
      assertEquals(
        (await previewDataModel(modelDeps, reader, {
          mode: "update",
          document: JSON.stringify(metadataOnly),
        })).can_apply,
        true,
      );
      const restrictedValues = structuredClone(metadataOnly);
      restrictedValues.entity_types.find((v) => v.schema["x-type-id"] === left.id)!
        .schema.properties.prop_1.maxLength = 1;
      const protectedPreview = await assertRejects(() =>
        previewDataModel(modelDeps, reader, {
          mode: "update",
          document: JSON.stringify(restrictedValues),
        }), AppError);
      assertEquals(protectedPreview.code, "forbidden");
      await workspaces.updateWorkspaceMember(workspaceDeps, key(a), owned[0], b.userId, {
        expected_version: 2,
        grants: [
          { target_kind: "settings", target_id: "*", access: "write" },
          { target_kind: "entity_type", target_id: left.id, access: "write" },
        ],
      });
      const dataInput = { mode: "update", document: JSON.stringify(restrictedValues) };
      const dataPreview = await previewDataModel(modelDeps, reader, dataInput);
      const dataRequest = key(reader);
      const dataPrepare = dataModelPrepare.parse({ ...dataInput, preview_fingerprint: dataPreview.fingerprint });
      const dataPlan = await prepareDataModel(modelDeps, dataRequest, dataPrepare);
      assertEquals(await prepareDataModel(modelDeps, dataRequest, dataPrepare), dataPlan);
      const identity = await requestIdentity(dataRequest, "data-model.prepare", null, dataPrepare);
      const [savedReceipt] = await admin`select footprint from private.workspace_request_results
        where workspace_id=${owned[0]}::uuid and executor_id=${b.userId}::uuid and request_key=${identity.key}::uuid`;
      assertEquals(savedReceipt.footprint, [
        { target_kind: "settings", target_id: "*", access: "write" },
        { target_kind: "entity_type", target_id: left.id, access: "write" },
      ]);
      await runInWorkspace(sql, reader, {
        mode: "business",
        requirements: [{ target_kind: "settings", target_id: "*", access: "write" }],
      }, async (tx) => {
        const stripRequirements = await assertRejects(() => tx.savepoint((attempt) => attempt`update app.data_model_changes
          set plan=jsonb_set(plan,'{protected_permissions}','[]'::jsonb)
          where workspace_id=${owned[0]}::uuid and id=${dataPlan.id}::uuid`));
        assertEquals((stripRequirements as { code?: string }).code, "23514");
        assertEquals((stripRequirements as Error).message, "model_plan_permissions_immutable");
      });
      await workspaces.updateWorkspaceMember(workspaceDeps, key(a), owned[0], b.userId, {
        expected_version: 3,
        grants: [{ target_kind: "settings", target_id: "*", access: "write" }],
      });
      await runInWorkspace(sql, reader, {
        mode: "business",
        requirements: [{ target_kind: "settings", target_id: "*", access: "write" }],
      }, async (tx) => {
        const disclosed = await tx`select plan from app.data_model_changes
          where workspace_id=${owned[0]}::uuid and id=${dataPlan.id}::uuid`;
        assertEquals(disclosed.length, 0);
        const stripped = await tx`update app.data_model_changes
          set plan=jsonb_set(plan,'{protected_permissions}','[]'::jsonb)
          where workspace_id=${owned[0]}::uuid and id=${dataPlan.id}::uuid returning id`;
        assertEquals(stripped.length, 0);
      });
      assertEquals(
        (await assertRejects(() => prepareDataModel(modelDeps, dataRequest, dataPrepare), AppError)).code,
        "forbidden",
      );
      assertEquals(
        (await assertRejects(() =>
          runInWorkspace(sql, dataRequest as Actor & { workspaceId: string }, {
            mode: "business",
            requirements: [{ target_kind: "settings", target_id: "*", access: "write" }],
          }, (tx) => replayRetainedSqlRequest(tx, dataRequest, identity)), AppError)).code,
        "forbidden",
      );
      assertEquals(
        (await assertRejects(() => getDataModelChange(modelDeps, reader, dataPlan.id), AppError)).code,
        "forbidden",
      );
      assertEquals(
        (await assertRejects(() => listDataModelChanges(modelDeps, reader, { limit: 100 }), AppError)).code,
        "forbidden",
      );
      for (const [actor, version] of [[a, 1], [b, 4]] as const) {
        await workspaces.updateWorkspaceMember(workspaceDeps, key(a), owned[0], actor.userId, {
          expected_version: version,
          grants: [
            { target_kind: "settings", target_id: "*", access: "write" },
            { target_kind: "entity_type", target_id: left.id, access: "write" },
          ],
        });
      }
      const externalId = crypto.randomUUID(), entityId = `app:${left.id}:${externalId}`;
      await runInWorkspace(sql, first, {
        mode: "business",
        requirements: [{ target_kind: "entity_type", target_id: left.id, access: "write" }],
      }, async (tx) => {
        await tx`insert into app.entities(workspace_id,id,source,external_id,entity_type_id,schema_version,properties)
          values(${owned[0]}::uuid,${entityId},'app',${externalId},${left.id}::uuid,1,${
          tx.json({ prop_1: "공유 값" })
        })`;
      });
      const sharedValuesReview = await previewDataModel(modelDeps, reader, dataInput);
      assertEquals(sharedValuesReview.items.find((item) => item.ref === `type_${left.id}`)?.kind, "migration_required");
      assertEquals((await exportDataModel(modelDeps, second)).entity_types.length, 1);
      const recordId = await runInWorkspace(sql, first, {
        mode: "business",
        requirements: [{ target_kind: "entity_type", target_id: left.id, access: "write" }],
      }, async (tx) => {
        const [record] = await tx`insert into app.records(workspace_id,entity_id,body)
          values(${owned[0]}::uuid,${entityId},'공유 자료 값의 변경 기록') returning id`;
        return record.id as string;
      });
      await runInWorkspace(sql, reader, {
        mode: "business",
        requirements: [{ target_kind: "entity_type", target_id: left.id, access: "read" }],
      }, async (tx) => {
        const [record] = await tx`select entity_id,task_id,body from app.records where workspace_id=${
          owned[0]
        }::uuid and id=${recordId}`;
        assertEquals(record, { entity_id: entityId, task_id: null, body: "공유 자료 값의 변경 기록" });
      });
      const parentMutation = await assertRejects(() =>
        admin`update app.records set entity_id=null where workspace_id=${owned[0]}::uuid and id=${recordId}`
      );
      assertEquals((parentMutation as { code?: string }).code, "23514");
      assertEquals((parentMutation as Error).message, "record_parent_immutable");
      const missingParent = await assertRejects(() =>
        admin.begin(async (tx) => {
          await tx`select set_config('request.workspace_id',${owned[0]},true)`;
          await tx`insert into app.records(workspace_id,body) values(${owned[0]}::uuid,'소속 누락은 거절')`;
        })
      );
      assertEquals((missingParent as { code?: string }).code, "23514");
      assertEquals((missingParent as { constraint_name?: string }).constraint_name, "record_workspace_exact_parent");
      const [parentAfter] = await admin`select entity_id,task_id from app.records where workspace_id=${
        owned[0]
      }::uuid and id=${recordId}`;
      assertEquals(parentAfter, { entity_id: entityId, task_id: null });
      const tagId = await admin.begin(async (tx) => {
        await tx`select set_config('request.workspace_id',${owned[0]},true)`;
        const [tag] = await tx`insert into app.tags(workspace_id,scope,name) values(${
          owned[0]
        }::uuid,'record','변환 기록') returning id`;
        return tag.id as string;
      });
      const taggedSettings = await settings.updateBusinessSettings(
        { uow: new SqlBusinessSettingsUnitOfWork(sql), clock: { now: () => new Date() } },
        key(first),
        {
          id: "record_templates",
          expected_version: 0,
          value: { entity_types: { [left.id]: { update: { memo: "$대상$ 값 변환", tag_ids: [tagId] } } } },
        },
      );
      assertEquals(taggedSettings.settings.record_templates?.entity_types?.[left.id]?.update?.tag_ids, [tagId]);
      await runInWorkspace(sql, first, {
        mode: "business",
        requirements: [{ target_kind: "entity_type", target_id: left.id, access: "write" }],
      }, async (tx) => {
        await tx`insert into app.record_tags(workspace_id,record_id,tag_id) values(${
          owned[0]
        }::uuid,${recordId},${tagId})`;
      });
      await runInWorkspace(sql, reader, {
        mode: "business",
        requirements: [{ target_kind: "entity_type", target_id: left.id, access: "read" }],
      }, async (tx) => {
        assertEquals(
          (await tx`select tag_id from app.record_tags where workspace_id=${owned[0]}::uuid and record_id=${recordId}`)
            .map((r) => r.tag_id),
          [tagId],
        );
      });
      const pickerTags = await listTags({ uow: new SqlTagUnitOfWork(sql) }, reader, {
        scope: "record",
        purpose: "record-template",
        limit: 100,
      });
      assertEquals(pickerTags.items.map((tag) => ({ id: tag.id, name: tag.name })), [{ id: tagId, name: "변환 기록" }]);
      await admin.begin(async (tx) => {
        await tx`select set_config('request.workspace_id',${owned[0]},true)`;
        await tx`insert into app.tags(workspace_id,scope,name) values(${owned[0]}::uuid,'record','다른 설정 태그')`;
      });
      const pickerPage = await listTags({ uow: new SqlTagUnitOfWork(sql) }, first, {
        scope: "record",
        purpose: "record-template",
        limit: 1,
      });
      assertEquals(typeof pickerPage.next_cursor, "string");
      const wrongPickerCursor = await assertRejects(() =>
        listTags({ uow: new SqlTagUnitOfWork(sql) }, second, {
          scope: "record",
          purpose: "record-template",
          limit: 1,
          cursor: pickerPage.next_cursor!,
        }), AppError);
      assertEquals(wrongPickerCursor.code, "invalid_input");
    } finally {
      for (const id of owned) await admin`delete from app.workspaces where id=${id}`;
      // Exact fresh account ownership also removes a legacy row if this RED tracer fails before scoping.
      for (const actor of [a, b]) await admin`delete from auth.users where id=${actor.userId}`;
    }
  },
);

dbTest(
  "shared record templates are workspace configuration and retained writes recheck current settings permission",
  async () => {
    const a = { userId: crypto.randomUUID() }, b = { userId: crypto.randomUUID() };
    for (const actor of [a, b]) {
      const email = `settings513-${actor.userId}@example.test`;
      await admin`insert into auth.users(id,email) values(${actor.userId},${email})`;
      await admin`insert into auth.identities(id,user_id,provider,provider_id,identity_data) values(${crypto.randomUUID()},${actor.userId},'google',${actor.userId},${
        admin.json({ sub: actor.userId, email, email_verified: true })
      })`;
    }
    const owned: string[] = [];
    const deps = { uow: new SqlBusinessSettingsUnitOfWork(sql), clock: { now: () => new Date() } };
    try {
      for (const name of ["설정 A", "설정 B"]) {
        owned.push(
          (await workspaces.createWorkspace(workspaceDeps, key(a), { name })).workspace.id,
        );
      }
      const first = { ...a, workspaceId: owned[0] }, second = { ...a, workspaceId: owned[1] };
      const request = key(first),
        input = {
          id: "record_templates",
          expected_version: 0,
          value: { task: { create: { memo: "첫 공간 문구", tag_ids: [] } } },
        };
      const saved = await settings.updateBusinessSettings(deps, request, input);
      assertEquals(saved.settings.record_templates?.task?.create?.memo, "첫 공간 문구");
      assertEquals((await settings.getBusinessSettings(deps, second)).versions.record_templates, 0);
      assertEquals(await settings.updateBusinessSettings(deps, request, input), saved);
      const invitation = await workspaces.inviteWorkspaceMember(workspaceDeps, key(a), owned[0], {
        email: `settings513-${b.userId}@example.test`,
        grants: [{ target_kind: "settings", target_id: "*", access: "write" }],
      });
      await workspaces.acceptWorkspaceInvitation(workspaceDeps, key(b), invitation.invitation.id);
      const manager = { ...b, workspaceId: owned[0] };
      const issuerDeps = { uow: new SqlEntityIssuerUnitOfWork(sql) };
      const kind = await types.createEntityType(typeDeps, key(manager), { label: "번호 설정" });
      await issuers.createEntityIssuer(issuerDeps, key(manager), { code: "custom", label: "외부" });
      const customRule = await issuers.createIdentifierRule(issuerDeps, key(manager), "custom", {
        label: "번호", meaning: "원래 의미",
      });
      const originalIdentity = await issuers.getEntityTypeIdentity(issuerDeps, manager, kind.id);
      const configuredIdentity = await issuers.updateEntityTypeIdentity(issuerDeps, key(manager), kind.id, {
        expected_version: originalIdentity.version,
        label: "외부 번호", default_source: "app",
        sources: [...originalIdentity.sources.map(({ code, rule_id, active }) => ({ code, rule_id, active })),
          { code: "custom", rule_id: customRule.id, active: true }],
      });
      const renamedRule = await issuers.updateIdentifierRule(issuerDeps, key(manager), customRule.id, {
        expected_version: customRule.version, label: "번호 이름 변경",
      });
      const deniedMeaning = await assertRejects(() => issuers.updateIdentifierRule(
        issuerDeps, key(manager), customRule.id,
        { expected_version: renamedRule.version, meaning: "변경된 의미" },
      ), AppError);
      assertEquals(deniedMeaning.code, "forbidden");
      const currentIdentity = await issuers.getEntityTypeIdentity(issuerDeps, manager, kind.id);
      const deniedRemoval = await assertRejects(() => issuers.updateEntityTypeIdentity(
        issuerDeps, key(manager), kind.id,
        { expected_version: currentIdentity.version, label: configuredIdentity.label, default_source: "app",
          sources: currentIdentity.sources.filter((s) => s.code !== "custom").map(({ code, rule_id, active }) => ({ code, rule_id, active })) },
      ), AppError);
      assertEquals(deniedRemoval.code, "forbidden");
      await workspaces.updateWorkspaceMember(workspaceDeps, key(b), owned[0], a.userId, {
        expected_version: 1,
        grants: [{ target_kind: "settings", target_id: "*", access: "read" }],
      });
      assertEquals(
        (await settings.getBusinessSettings(deps, first)).settings.record_templates?.task?.create?.memo,
        "첫 공간 문구",
      );
      const error = await assertRejects(() => settings.updateBusinessSettings(deps, request, input), AppError);
      assertEquals(error.code, "forbidden");
      const deniedRegistry = await assertRejects(
        () => issuers.createEntityIssuer(issuerDeps, key(first), { code: "external", label: "원본" }),
        AppError,
      );
      assertEquals(deniedRegistry.code, "forbidden");
    } finally {
      for (const id of owned) await admin`delete from app.workspaces where id=${id}`;
      for (const actor of [a, b]) await admin`delete from auth.users where id=${actor.userId}`;
    }
  },
);

dbTest("business memo preparation uses only its permitted workspace target without settings read", async () => {
  const a = { userId: crypto.randomUUID() }, b = { userId: crypto.randomUUID() };
  for (const actor of [a, b]) {
    const email = `memo513-${actor.userId}@example.test`;
    await admin`insert into auth.users(id,email) values(${actor.userId},${email})`;
    await admin`insert into auth.identities(id,user_id,provider,provider_id,identity_data) values(${crypto.randomUUID()},${actor.userId},'google',${actor.userId},${
      admin.json({ sub: actor.userId, email, email_verified: true })
    })`;
  }
  const owned: string[] = [], tagIds: string[] = [];
  const deps = { uow: new SqlBusinessSettingsUnitOfWork(sql), clock: { now: () => new Date() } };
  try {
    for (const memo of ["첫 공간 준비", "다른 공간 준비"]) {
      const id = (await workspaces.createWorkspace(workspaceDeps, key(a), { name: memo })).workspace.id;
      owned.push(id);
      const tagId = await admin.begin(async (tx) => {
        await tx`select set_config('request.workspace_id',${id},true)`;
        const [tag] =
          await tx`insert into app.tags(workspace_id,scope,name) values(${id}::uuid,'record','준비 문구 태그') returning id`;
        return tag.id as string;
      });
      tagIds.push(tagId);
      await settings.updateBusinessSettings(deps, key({ ...a, workspaceId: id }), {
        id: "record_templates",
        expected_version: 0,
        value: {
          task: { create: { memo, tag_ids: [tagId] }, update: { memo: "공개하지 않을 다른 동작 설정", tag_ids: [] } },
        },
      });
      const invitation = await workspaces.inviteWorkspaceMember(workspaceDeps, key(a), id, {
        email: `memo513-${b.userId}@example.test`,
        grants: [{ target_kind: "tasks", target_id: "*", access: "write" }],
      });
      await workspaces.acceptWorkspaceInvitation(workspaceDeps, key(b), invitation.invitation.id);
    }
    const prepare = (id: string) =>
      settings.prepareBusinessRecord(deps, { ...b, workspaceId: id }, {
        model: "task",
        action: "create",
        input: { kind: "once", title: "업무" },
      });
    for (const id of owned) {
      const error = await assertRejects(() => settings.getBusinessSettings(deps, { ...b, workspaceId: id }), AppError);
      assertEquals(error.code, "forbidden");
      const metadataError = await assertRejects(
        () =>
          listTags({ uow: new SqlTagUnitOfWork(sql) }, { ...b, workspaceId: id }, {
            scope: "record",
            purpose: "record-template",
            limit: 100,
          }),
        AppError,
      );
      assertEquals(metadataError.code, "forbidden");
    }
    const first = await prepare(owned[0]), second = await prepare(owned[1]);
    assertEquals(first.change_note, "첫 공간 준비");
    assertEquals(second.change_note, "다른 공간 준비");
    assertEquals(first.change_tag_ids, [tagIds[0]]);
    assertEquals(second.change_tag_ids, [tagIds[1]]);
    assertEquals(first.missing_tag_ids, []);
    const foreignTag = await assertRejects(
      () =>
        settings.updateBusinessSettings(deps, key({ ...a, workspaceId: owned[0] }), {
          id: "record_templates",
          expected_version: 1,
          value: { task: { create: { memo: "다른 공간 태그는 연결하지 않음", tag_ids: [tagIds[1]] } } },
        }),
      AppError,
    );
    assertEquals(foreignTag.code, "invalid_input");
    assertEquals((await prepare(owned[0])).change_tag_ids, [tagIds[0]]);

    assertEquals(Object.hasOwn(first, "settings"), false);
    assertEquals(JSON.stringify(first).includes("공개하지 않을 다른 동작 설정"), false);
    await workspaces.updateWorkspaceMember(workspaceDeps, key(a), owned[0], b.userId, {
      expected_version: 1,
      grants: [],
    });
    const error = await assertRejects(() => prepare(owned[0]), AppError);
    assertEquals(error.code, "forbidden");
  } finally {
    for (const id of owned) await admin`delete from app.workspaces where id=${id}`;
    for (const actor of [a, b]) await admin`delete from auth.users where id=${actor.userId}`;
  }
});

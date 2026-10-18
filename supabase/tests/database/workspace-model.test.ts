import { exportDataModel, previewDataModel } from "../../functions/_shared/core/data-model/application.ts";
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
      const reviewInput = { mode: "copy", document: JSON.stringify(exported) };
      const [managerA, managerB] = await Promise.all([
        previewDataModel(modelDeps, first, reviewInput),
        previewDataModel(modelDeps, reader, reviewInput),
      ]);
      assertEquals(managerA.mapping, managerB.mapping);
      assertEquals(managerA.fingerprint, managerB.fingerprint);
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
      const issuerDeps = { uow: new SqlEntityIssuerUnitOfWork(sql) };
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
  const owned: string[] = [];
  const deps = { uow: new SqlBusinessSettingsUnitOfWork(sql), clock: { now: () => new Date() } };
  try {
    for (const memo of ["첫 공간 준비", "다른 공간 준비"]) {
      const id = (await workspaces.createWorkspace(workspaceDeps, key(a), { name: memo })).workspace.id;
      owned.push(id);
      await settings.updateBusinessSettings(deps, key({ ...a, workspaceId: id }), {
        id: "record_templates",
        expected_version: 0,
        value: {
          task: { create: { memo, tag_ids: [] }, update: { memo: "공개하지 않을 다른 동작 설정", tag_ids: [] } },
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
    }
    const first = await prepare(owned[0]), second = await prepare(owned[1]);
    assertEquals(first.change_note, "첫 공간 준비");
    assertEquals(second.change_note, "다른 공간 준비");
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

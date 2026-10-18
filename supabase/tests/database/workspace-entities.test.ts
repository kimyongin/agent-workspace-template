import { assertEquals, assertRejects } from "@std/assert";
import { SqlEntityUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-store.ts";
import { SqlEntityTypeUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-type-store.ts";
import { SqlWorkspaceUnitOfWork } from "../../functions/_shared/adapters/supabase/workspace-store.ts";
import { entityCreate, entityListQuery, entityUpdate } from "../../functions/_shared/contracts/entity.ts";
import * as entities from "../../functions/_shared/core/entity/application.ts";
import * as types from "../../functions/_shared/core/entity-types/application.ts";
import * as workspaces from "../../functions/_shared/core/workspaces/application.ts";
import type { Actor } from "../../functions/_shared/core/shared/actor.ts";
import { AppError } from "../../functions/_shared/core/shared/errors.ts";
import { connect, dbTest, urls } from "./_db.ts";

const admin = connect(urls.admin, { max: 1 });
const sql = connect(urls.direct, { max: 5, prepare: false });
const workspaceDeps = { uow: new SqlWorkspaceUnitOfWork(sql) };
const typeDeps = { uow: new SqlEntityTypeUnitOfWork(sql) };
const deps = { uow: new SqlEntityUnitOfWork(sql) };
const key = (actor: Actor): Actor => ({ ...actor, request: { key: crypto.randomUUID() } });

dbTest("workspace entities public create shares values with kind writer and atomically owns its change", async () => {
  const a = { userId: crypto.randomUUID() }, b = { userId: crypto.randomUUID() };
  const owned: string[] = [], seeded: string[] = [];
  try {
    for (const actor of [a, b]) {
      const email = `entity514-${actor.userId}@example.test`;
      await admin`insert into auth.users(id,email) values(${actor.userId},${email})`;
      seeded.push(actor.userId);
      await admin`insert into auth.identities(id,user_id,provider,provider_id,identity_data) values(${crypto.randomUUID()},${actor.userId},'google',${actor.userId},${
        admin.json({ sub: actor.userId, email, email_verified: true })
      })`;
    }
    for (const name of ["공유 자료 공간", "다른 자료 공간"]) {
      owned.push((await workspaces.createWorkspace(workspaceDeps, key(a), { name })).workspace.id);
    }
    const author = { ...a, workspaceId: owned[0] }, other = { ...a, workspaceId: owned[1] };
    const type = await types.createEntityType(typeDeps, key(author), { label: "공유 자료" });
    const none = await assertRejects(() =>
      entities.createEntity(
        deps,
        key(author),
        entityCreate.parse({
          entity_type_id: type.id,
          schema_version: 1,
          properties: { prop_1: "권한 이전 비공개" },
        }),
      ), AppError);
    assertEquals(none.code, "forbidden");
    await workspaces.updateWorkspaceMember(workspaceDeps, key(a), owned[0], a.userId, {
      expected_version: 1,
      grants: [{ target_kind: "settings", target_id: "*", access: "write" }, {
        target_kind: "entity_type",
        target_id: type.id,
        access: "write",
      }],
    });
    const invitation = await workspaces.inviteWorkspaceMember(workspaceDeps, key(a), owned[0], {
      email: `entity514-${b.userId}@example.test`,
      grants: [{ target_kind: "entity_type", target_id: type.id, access: "write" }],
    });
    await workspaces.acceptWorkspaceInvitation(workspaceDeps, key(b), invitation.invitation.id);
    const writer = { ...b, workspaceId: owned[0] };
    const request = key(author);
    const input = entityCreate.parse({
      entity_type_id: type.id,
      schema_version: 1,
      properties: { prop_1: "A가 만든 공유 자료" },
    });
    const created = await entities.createEntity(deps, request, input);
    assertEquals(await entities.createEntity(deps, request, input), created);
    assertEquals((await entities.getEntity(deps, writer, created.id)).title, "A가 만든 공유 자료");
    const updated = await entities.updateEntity(
      deps,
      key(writer),
      created.id,
      entityUpdate.parse({
        schema_version: 1,
        expected_version: 1,
        properties: { prop_1: "B가 바꾼 공유 자료" },
        change_note: "공유 수정",
      }),
    );
    assertEquals(updated.version, 2);
    assertEquals((await entities.getEntity(deps, author, created.id)).title, "B가 바꾼 공유 자료");
    assertEquals(
      (await entities.listEntities(deps, author, entityListQuery.parse({ entity_type_id: type.id }))).items.map((row) =>
        row.id
      ),
      [created.id],
    );
    assertEquals((await assertRejects(() => entities.getEntity(deps, other, created.id), AppError)).code, "not_found");
    await workspaces.updateWorkspaceMember(workspaceDeps, key(a), owned[0], b.userId, {
      expected_version: 1,
      grants: [],
    });
    assertEquals((await assertRejects(() => entities.getEntity(deps, writer, created.id), AppError)).code, "not_found");
    const [saved] = await admin`select workspace_id,owner_id from app.entities where workspace_id=${
      owned[0]
    } and id=${created.id}`;
    assertEquals(saved, { workspace_id: owned[0], owner_id: null });
    const changes = await admin`select id,entity_id,task_id,owner_id from app.records where workspace_id=${
      owned[0]
    } and entity_id=${created.id} order by created_at,id`;
    assertEquals(changes.length, 2);
    for (const change of changes) {
      assertEquals([change.entity_id, change.task_id, change.owner_id], [created.id, null, null]);
      assertEquals(
        Number(
          (await admin`select count(*) n from pgmq.q_search_index where message->>'workspace_id'=${
            owned[0]
          } and message->>'id'=${change.id}`)[0].n,
        ),
        1,
      );
    }
    const receipts = await admin`select footprint from private.workspace_request_results where workspace_id=${
      owned[0]
    } and operation in ('entity.create','entity.update')`;
    assertEquals(receipts.length, 2);
    for (const receipt of receipts) {
      assertEquals(receipt.footprint, [{ target_kind: "entity_type", target_id: type.id, access: "write" }]);
    }
  } finally {
    for (const id of owned) {
      await admin`delete from pgmq.q_search_index where message->>'workspace_id'=${id}`;
      await admin`delete from app.workspaces where id=${id}`;
    }
    for (const id of seeded) await admin`delete from auth.users where id=${id}`;
  }
});

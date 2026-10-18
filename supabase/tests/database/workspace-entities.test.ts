import * as tags from "../../functions/_shared/core/tags/application.ts";
import { SqlTagUnitOfWork } from "../../functions/_shared/adapters/supabase/tag-store.ts";
import { runInWorkspace } from "../../functions/_shared/adapters/supabase/workspace-context.ts";
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

dbTest("workspace record producer hides existing and missing sources after kind revocation", async () => {
  const a = { userId: crypto.randomUUID() }, b = { userId: crypto.randomUUID() };
  const seeded: string[] = [];
  let workspaceId: string | undefined;
  try {
    for (const actor of [a, b]) {
      const email = `producer514-${actor.userId}@example.test`;
      await admin`insert into auth.users(id,email) values(${actor.userId},${email})`;
      seeded.push(actor.userId);
      await admin`insert into auth.identities(id,user_id,provider,provider_id,identity_data) values(${crypto.randomUUID()},${actor.userId},'google',${actor.userId},${
        admin.json({ sub: actor.userId, email, email_verified: true })
      })`;
    }
    workspaceId = (await workspaces.createWorkspace(workspaceDeps, key(a), { name: "생산자 권한 검사" })).workspace.id;
    const author = { ...a, workspaceId }, reader = { ...b, workspaceId };
    const type = await types.createEntityType(typeDeps, key(author), { label: "보호 자료" });
    await workspaces.updateWorkspaceMember(workspaceDeps, key(a), workspaceId, a.userId, {
      expected_version: 1,
      grants: [
        { target_kind: "settings", target_id: "*", access: "write" },
        { target_kind: "entity_type", target_id: type.id, access: "write" },
      ],
    });
    const invitation = await workspaces.inviteWorkspaceMember(workspaceDeps, key(a), workspaceId, {
      email: `producer514-${b.userId}@example.test`,
      grants: [{ target_kind: "entity_type", target_id: type.id, access: "read" }],
    });
    await workspaces.acceptWorkspaceInvitation(workspaceDeps, key(b), invitation.invitation.id);
    // The SQL fixture exercises the already accepted #513 anchored-parent store;
    // the regression under test is the direct app_user producer function.
    const recordId = await runInWorkspace(sql, author, {
      mode: "business",
      requirements: [{ target_kind: "entity_type", target_id: type.id, access: "write" }],
    }, async (tx) => {
      const external = crypto.randomUUID(), id = `app:${type.id}:${external}`;
      await tx`insert into app.entities(workspace_id,id,source,external_id,entity_type_id,schema_version,properties) values(${workspaceId!},${id},'app',${external},${type.id},1,'{"prop_1":"공개하지 않을 값"}')`;
      const [record] =
        await tx`insert into app.records(workspace_id,entity_id,body) values(${workspaceId!},${id},'공개하지 않을 본문') returning id`;
      return String(record.id);
    });
    await workspaces.updateWorkspaceMember(workspaceDeps, key(a), workspaceId, b.userId, {
      expected_version: 1,
      grants: [],
    });
    for (const id of [recordId, "19990101-000000000000"]) {
      await runInWorkspace(sql, reader, { mode: "business", requirements: [] }, async (tx) => {
        const denied = await assertRejects(() =>
          tx.savepoint((nested) =>
            nested`select app.enqueue_search_index('record',${id},repeat('0',64),'oracle-regression')`
          )
        );
        assertEquals([(denied as { code?: string }).code, (denied as Error).message], ["42501", "workspace_denied"]);
      });
    }
    assertEquals(
      Number((await admin`select count(*) n from app.search_index_state where workspace_id=${workspaceId}`)[0].n),
      0,
    );
    assertEquals(
      Number(
        (await admin`select count(*) n from pgmq.q_search_index where message->>'workspace_id'=${workspaceId}`)[0].n,
      ),
      0,
    );
  } finally {
    if (workspaceId) {
      await admin`delete from pgmq.q_search_index where message->>'workspace_id'=${workspaceId}`;
      await admin`delete from app.workspaces where id=${workspaceId}`;
    }
    for (const id of seeded) await admin`delete from auth.users where id=${id}`;
  }
});

dbTest("workspace entity lists bind readable kinds and cursors while lifecycle retains one parent", async () => {
  const a = { userId: crypto.randomUUID() }, b = { userId: crypto.randomUUID() };
  const seeded: string[] = [], owned: string[] = [];
  try {
    for (const actor of [a, b]) {
      const email = `list514-${actor.userId}@example.test`;
      await admin`insert into auth.users(id,email) values(${actor.userId},${email})`;
      seeded.push(actor.userId);
      await admin`insert into auth.identities(id,user_id,provider,provider_id,identity_data) values(${crypto.randomUUID()},${actor.userId},'google',${actor.userId},${
        admin.json({ sub: actor.userId, email, email_verified: true })
      })`;
    }
    for (const name of ["자료 목록 공간", "다른 목록 공간"]) {
      owned.push((await workspaces.createWorkspace(workspaceDeps, key(a), { name })).workspace.id);
    }
    const author = { ...a, workspaceId: owned[0] }, other = { ...a, workspaceId: owned[1] };
    const visible = await types.createEntityType(typeDeps, key(author), { label: "보이는 자료" });
    const hidden = await types.createEntityType(typeDeps, key(author), { label: "설정에만 보이는 새 종류" });
    await workspaces.updateWorkspaceMember(workspaceDeps, key(a), owned[0], a.userId, {
      expected_version: 1,
      grants: [
        { target_kind: "settings", target_id: "*", access: "write" },
        { target_kind: "entity_type", target_id: visible.id, access: "write" },
      ],
    });
    const invitation = await workspaces.inviteWorkspaceMember(workspaceDeps, key(a), owned[0], {
      email: `list514-${b.userId}@example.test`,
      grants: [{ target_kind: "entity_type", target_id: visible.id, access: "read" }],
    });
    await workspaces.acceptWorkspaceInvitation(workspaceDeps, key(b), invitation.invitation.id);
    const reader = { ...b, workspaceId: owned[0] };
    const rows: Awaited<ReturnType<typeof entities.createEntity>>[] = [];
    for (const title of ["가 공유", "나 공유"]) {
      rows.push(
        await entities.createEntity(
          deps,
          key(author),
          entityCreate.parse({ entity_type_id: visible.id, schema_version: 1, properties: { prop_1: title } }),
        ),
      );
    }
    // Settings visibility must not turn the hidden kind into business authority,
    // nor make the entire untyped list fail because that kind is discoverable.
    assertEquals((await entities.listEntities(deps, author, entityListQuery.parse({}))).items.length, 2);
    assertEquals(
      (await assertRejects(
        () => entities.listEntities(deps, author, entityListQuery.parse({ entity_type_id: hidden.id })),
        AppError,
      )).code,
      "forbidden",
    );
    const query = entityListQuery.parse({
      entity_type_id: visible.id,
      sort: { key: "prop_1", direction: "asc" },
      filters: [{ key: "prop_1", operator: "contains", value: "공유" }],
      limit: 1,
    });
    const first = await entities.listEntities(deps, reader, query);
    const second = await entities.listEntities(deps, reader, { ...query, cursor: first.next_cursor! });
    assertEquals([...first.items, ...second.items].map((row) => row.title), ["가 공유", "나 공유"]);
    assertEquals(second.next_cursor, null);
    assertEquals(
      (await assertRejects(() =>
        entities.updateEntity(
          deps,
          key(reader),
          rows[0].id,
          entityUpdate.parse({ expected_version: 1, schema_version: 1, properties: { prop_1: "읽기만 가능" } }),
        ), AppError)).code,
      "forbidden",
    );
    // The same actor receives equivalent kinds in W2; a W1 cursor still refuses.
    const otherKind = await types.createEntityType(typeDeps, key(other), { label: "보이는 자료" });
    await workspaces.updateWorkspaceMember(workspaceDeps, key(a), owned[1], a.userId, {
      expected_version: 1,
      grants: [
        { target_kind: "settings", target_id: "*", access: "write" },
        { target_kind: "entity_type", target_id: otherKind.id, access: "write" },
      ],
    });
    const ownFirst = await entities.listEntities(deps, author, entityListQuery.parse({ limit: 1 }));
    assertEquals(
      (await assertRejects(
        () => entities.listEntities(deps, other, entityListQuery.parse({ limit: 1, cursor: ownFirst.next_cursor! })),
        AppError,
      )).code,
      "invalid_input",
    );
    const deletedRequest = key(author);
    await entities.deleteEntity(deps, deletedRequest, rows[0].id, 1);
    assertEquals(await entities.deleteEntity(deps, deletedRequest, rows[0].id, 1), { deleted: true });
    assertEquals(
      (await entities.listEntities(deps, reader, entityListQuery.parse({ entity_type_id: visible.id }))).items.map(
        (row) => row.id,
      ),
      [rows[1].id],
    );
    const deleted = await entities.getEntity(deps, reader, rows[0].id);
    assertEquals(deleted.version, 2);
    const restored = await entities.createEntity(
      deps,
      key(author),
      entityCreate.parse({
        entity_type_id: visible.id,
        schema_version: 1,
        source: rows[0].source,
        external_id: rows[0].external_id,
        expected_version: 2,
        properties: { prop_1: "같은 자료 복원" },
      }),
    );
    assertEquals([restored.id, restored.version], [rows[0].id, 3]);
    const history = await entities.getEntity(deps, reader, rows[0].id);
    assertEquals(history.records.count, 3);
    const parents = await admin`select entity_id,task_id from app.records where workspace_id=${
      owned[0]
    } and entity_id=${rows[0].id}`;
    assertEquals(parents.length, 3);
    assertEquals(parents.every((parent) => parent.entity_id === rows[0].id && parent.task_id === null), true);
    await workspaces.updateWorkspaceMember(workspaceDeps, key(a), owned[0], a.userId, {
      expected_version: 2,
      grants: [{ target_kind: "settings", target_id: "*", access: "write" }],
    });
    assertEquals(
      (await assertRejects(() => entities.deleteEntity(deps, deletedRequest, rows[0].id, 1), AppError)).code,
      "not_found",
    );
    assertEquals((await entities.listEntities(deps, author, entityListQuery.parse({}))).items, []);
  } finally {
    for (const id of owned) {
      await admin`delete from pgmq.q_search_index where message->>'workspace_id'=${id}`;
      await admin`delete from app.workspaces where id=${id}`;
    }
    for (const id of seeded) await admin`delete from auth.users where id=${id}`;
  }
});

dbTest("workspace entity saved tag connection preserves content and owns its independent change", async () => {
  const actor = { userId: crypto.randomUUID() }, business = { userId: crypto.randomUUID() };
  const seeded: string[] = [];
  let workspaceId: string | undefined;
  try {
    for (const user of [actor, business]) {
      const email = `tag514-${user.userId}@example.test`;
      await admin`insert into auth.users(id,email) values(${user.userId},${email})`;
      seeded.push(user.userId);
      await admin`insert into auth.identities(id,user_id,provider,provider_id,identity_data) values(${crypto.randomUUID()},${user.userId},'google',${user.userId},${
        admin.json({ sub: user.userId, email, email_verified: true })
      })`;
    }
    workspaceId =
      (await workspaces.createWorkspace(workspaceDeps, key(actor), { name: "독립 태그 공간" })).workspace.id;
    const kind = await types.createEntityType(typeDeps, key({ ...actor, workspaceId }), { label: "태그 자료" });
    const invitation = await workspaces.inviteWorkspaceMember(workspaceDeps, key(actor), workspaceId, {
      email: `tag514-${business.userId}@example.test`,
      grants: [{ target_kind: "entity_type", target_id: kind.id, access: "write" }],
    });
    await workspaces.acceptWorkspaceInvitation(workspaceDeps, key(business), invitation.invitation.id);
    const author = { ...business, workspaceId };
    const created = await entities.createEntity(
      deps,
      key(author),
      entityCreate.parse({ entity_type_id: kind.id, schema_version: 1, properties: { prop_1: "연결과 무관한 원문" } }),
    );
    const tagDeps = { uow: new SqlTagUnitOfWork(sql) };
    const tag = await tags.createTag(tagDeps, key(author), { scope: "entity", name: "보기에서 연결" });
    // Start with the current public module so the missing command is a runtime
    // feature failure, rather than a type/import-only failure before the DB seam.
    const set = (tags as unknown as {
      setTagConnections(
        d: tags.TagDeps,
        a: Actor,
        input: unknown,
      ): Promise<{ tag_ids: string[]; version: number; updated_at: string }>;
    }).setTagConnections;
    const request = key(author);
    const input = { target_kind: "entity", target_id: created.id, expected_version: 1, tag_ids: [tag.id] };
    const linked = await set(tagDeps, request, input);
    assertEquals([linked.tag_ids, linked.version], [[tag.id], 2]);
    assertEquals(await set(tagDeps, request, input), linked);
    const saved = await entities.updateEntity(
      deps,
      key(author),
      created.id,
      entityUpdate.parse({ expected_version: 2, schema_version: 1, properties: { prop_1: "내용만 수정" } }),
    );
    assertEquals([saved.properties.prop_1, saved.tag_ids, saved.version], ["내용만 수정", [tag.id], 3]);
    const unlinked = await set(tagDeps, key(author), {
      target_kind: "entity",
      target_id: created.id,
      expected_version: 3,
      tag_ids: [],
    });
    assertEquals([unlinked.tag_ids, unlinked.version], [[], 4]);
    const after = await entities.getEntity(deps, author, created.id);
    assertEquals([after.properties.prop_1, after.records.count], ["내용만 수정", 4]);
    assertEquals((await tags.listTags(tagDeps, author, { scope: "entity", limit: 100 })).items.map((row) => row.id), [
      tag.id,
    ]);
  } finally {
    if (workspaceId) {
      await admin`delete from pgmq.q_search_index where message->>'workspace_id'=${workspaceId}`;
      await admin`delete from app.workspaces where id=${workspaceId}`;
    }
    for (const id of seeded) await admin`delete from auth.users where id=${id}`;
  }
});

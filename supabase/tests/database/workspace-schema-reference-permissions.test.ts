import { assertEquals, assertRejects } from "@std/assert";
import { connect, dbTest, urls } from "./_db.ts";
import { runInWorkspace } from "../../functions/_shared/adapters/supabase/workspace-context.ts";
import { SqlWorkspaceUnitOfWork } from "../../functions/_shared/adapters/supabase/workspace-store.ts";
import { SqlEntityTypeUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-type-store.ts";
import { SqlDataModelUnitOfWork } from "../../functions/_shared/adapters/supabase/data-model-store.ts";
import { SqlDataModelGroupStore } from "../../functions/_shared/adapters/supabase/data-model-group-store.ts";
import type { Actor } from "../../functions/_shared/core/shared/actor.ts";
import { AppError } from "../../functions/_shared/core/shared/errors.ts";
import * as workspaces from "../../functions/_shared/core/workspaces/application.ts";
import * as types from "../../functions/_shared/core/entity-types/application.ts";
import {
  applyDataModel,
  exportDataModel,
  getDataModelChange,
  prepareDataModel,
  previewDataModel,
} from "../../functions/_shared/core/data-model/application.ts";
import { analyzeDataModel } from "../../functions/_shared/core/data-model/groups.ts";
import { compileMigration } from "../../functions/_shared/core/entity-types/conversions.ts";
import { prepareMigrationBatch } from "../../functions/_shared/core/entity-types/migration-preparation.ts";
import { SEARCH_PIPELINE } from "../../functions/_shared/core/search/config.ts";

const admin = connect(urls.admin, { max: 1 });
const sql = connect(urls.direct, { max: 2, prepare: false });
const workerUrl = new URL(urls.admin);
workerUrl.username = "app_worker";
workerUrl.password = Deno.env.get("APP_WORKER_PASSWORD")!;
const worker = connect(workerUrl.toString(), { max: 1 });
const workspaceDeps = { uow: new SqlWorkspaceUnitOfWork(sql) };
const typeDeps = { uow: new SqlEntityTypeUnitOfWork(sql) };
const modelDeps = { uow: new SqlDataModelUnitOfWork(sql, SqlDataModelGroupStore) };
const key = (actor: Actor): Actor => ({ ...actor, request: { key: crypto.randomUUID() } });

async function linkedReferenceFixture(withTask: boolean) {
  const a = { userId: crypto.randomUUID() }, b = { userId: crypto.randomUUID() };
  let workspaceId: string | undefined;
  for (const actor of [a, b]) {
    const email = `reference513-${actor.userId}@example.test`;
    await admin`insert into auth.users(id,email) values(${actor.userId},${email})`;
    await admin`insert into auth.identities(id,user_id,provider,provider_id,identity_data)
      values(${crypto.randomUUID()},${actor.userId},'google',${actor.userId},${
      admin.json({ sub: actor.userId, email, email_verified: true })
    })`;
  }
  try {
    workspaceId = (await workspaces.createWorkspace(workspaceDeps, key(a), { name: "연결 읽기 권한" })).workspace.id;
    const author = { ...a, workspaceId }, executor = { ...b, workspaceId };
    const own = await types.createEntityType(typeDeps, key(author), { label: "변환 대상" });
    const peer = await types.createEntityType(typeDeps, key(author), { label: "읽기 전용 연결 대상" });
    const full = [
      { target_kind: "settings", target_id: "*", access: "write" },
      { target_kind: "entity_type", target_id: own.id, access: "write" },
      { target_kind: "entity_type", target_id: peer.id, access: "write" },
    ];
    if (withTask) full.push({ target_kind: "tasks", target_id: "*", access: "write" });
    await workspaces.updateWorkspaceMember(workspaceDeps, key(a), workspaceId, a.userId, {
      expected_version: 1,
      grants: full,
    });
    const limited = full.map((r) =>
      r.target_id === peer.id || r.target_kind === "tasks" ? { ...r, access: "read" } : r
    );
    const invited = await workspaces.inviteWorkspaceMember(workspaceDeps, key(a), workspaceId, {
      email: `reference513-${b.userId}@example.test`,
      grants: limited,
    });
    await workspaces.acceptWorkspaceInvitation(workspaceDeps, key(b), invited.invitation.id);
    const document = await exportDataModel(modelDeps, author);
    document.relations.push({
      id: crypto.randomUUID(),
      version: 1,
      archived: false,
      ends: [
        {
          type_ref: document.entity_types.find((t) => t.schema["x-type-id"] === own.id)!.ref,
          label: "대상",
          cardinality: "many",
        },
        {
          type_ref: document.entity_types.find((t) => t.schema["x-type-id"] === peer.id)!.ref,
          label: "참고",
          cardinality: "many",
        },
      ],
    });
    const relationInput = { mode: "update", document: JSON.stringify(document) };
    const relationPreview = await previewDataModel(modelDeps, author, relationInput);
    const relationPlan = await prepareDataModel(modelDeps, key(author), {
      ...relationInput,
      preview_fingerprint: relationPreview.fingerprint,
    });
    assertEquals(
      (await applyDataModel(modelDeps, key(author), relationPlan.id, { expected_version: relationPlan.version }))
        .status,
      "applied",
    );
    const published = await exportDataModel(modelDeps, author);
    const entityIds: string[] = [];
    for (const kind of [own, peer]) {
      const externalId = crypto.randomUUID(), id = `app:${kind.id}:${externalId}`;
      entityIds.push(id);
      await runInWorkspace(
        sql,
        author,
        { mode: "business", requirements: [{ target_kind: "entity_type", target_id: kind.id, access: "write" }] },
        (tx) =>
          tx`insert into app.entities(workspace_id,id,source,external_id,entity_type_id,schema_version,properties)
          values(${author.workspaceId},${id},'app',${externalId},${kind.id},1,'{"prop_1":"12"}')`,
      );
    }
    // A real strict scoped link proves the graph boundary; no legacy owner is adopted.
    await runInWorkspace(
      sql,
      author,
      { mode: "business", requirements: full.slice(1) as workspaces.WorkspaceRequirement[] },
      (tx) =>
        tx`insert into app.entity_relation_links(workspace_id,owner_id,definition_id,left_entity_id,right_entity_id)
        values(${author.workspaceId},null,${published.relations[0].id},${entityIds[0]},${entityIds[1]})`,
    );
    assertEquals(
      (await admin`select owner_id from app.entity_relation_links where workspace_id=${workspaceId}`)[0].owner_id,
      null,
    );
    if (withTask) {
      const taskId = crypto.randomUUID();
      const contexts = [own, peer].map((kind, index) => ({
        id: entityIds[index],
        title: "선택된 자료",
        schema_version: 1,
        captured_at: new Date().toISOString(),
        source: "selection",
        type: { id: kind.id, label: kind.label, icon_id: kind.icon_id, archived: false },
      }));
      await runInWorkspace(
        sql,
        author,
        { mode: "business", requirements: full as workspaces.WorkspaceRequirement[] },
        (tx) =>
          tx`insert into app.tasks(workspace_id,owner_id,id,kind,title,body,status,entity_ids,entity_context)
          values(${author.workspaceId},null,${taskId},'once','연결 선택 보관','할 일 읽기 권한이 필요한 문맥','open',${entityIds}::text[],${
            tx.json(contexts)
          })`,
      );
      assertEquals(
        (await admin`select owner_id from app.tasks where workspace_id=${workspaceId} and id=${taskId}`)[0].owner_id,
        null,
      );
    }
    const target = await exportDataModel(modelDeps, executor);
    const ownTarget = target.entity_types.find((t) => t.schema["x-type-id"] === own.id)!;
    ownTarget.schema.properties.prop_1.maxLength = 1;
    const input = { mode: "update", document: JSON.stringify(target) };
    const preview = await previewDataModel(modelDeps, executor, input);
    const saved = await prepareDataModel(modelDeps, key(executor), {
      ...input,
      preview_fingerprint: preview.fingerprint,
    });
    await analyzeDataModel(modelDeps, key(executor), saved.id, {
      expected_version: saved.version,
      conversions: [{
        type_ref: ownTarget.ref,
        migration: { rules: [], overrides: [{ entity_id: entityIds[0], key: "prop_1", value: "X" }] },
      }],
    });
    const [analysis] = await worker`select app.claim_entity_schema_analysis() as batch`;
    const convert = compileMigration(analysis.batch.target, analysis.batch.migration, analysis.batch.recovery_keys);
    assertEquals(
      (await worker`select app.complete_entity_schema_analysis_batch(${analysis.batch.id},${analysis.batch.fence},${
        worker.json(analysis.batch.rows.map((r: { entity_id: string; properties: Record<string, unknown> }) =>
          convert(r.entity_id, r.properties)
        ))
      }) as accepted`)[0].accepted,
      true,
    );
    const ready = await getDataModelChange(modelDeps, executor, saved.id);
    const activation = key(executor), activationInput = { expected_version: ready.version };
    await applyDataModel(modelDeps, activation, saved.id, activationInput);
    const [job] =
      await admin`select required_permissions from app.entity_schema_migrations where workspace_id=${workspaceId} and model_change_id=${saved.id}`;
    assertEquals(
      job.required_permissions.some((r: workspaces.WorkspaceRequirement) =>
        r.target_kind === "entity_type" && r.target_id === peer.id && r.access === "read"
      ),
      true,
    );
    assertEquals(
      job.required_permissions.some((r: workspaces.WorkspaceRequirement) =>
        r.target_id === peer.id && r.access === "write"
      ),
      false,
    );
    await workspaces.updateWorkspaceMember(workspaceDeps, key(a), workspaceId, b.userId, {
      expected_version: 1,
      grants: limited.filter((r) => r.target_id !== peer.id),
    });
    assertEquals((await worker`select app.claim_data_model_conversion() as batch`)[0].batch, null);
    assertEquals(
      (await assertRejects(() => getDataModelChange(modelDeps, executor, saved.id), AppError)).code,
      "forbidden",
    );
    assertEquals(
      (await assertRejects(() => applyDataModel(modelDeps, activation, saved.id, activationInput), AppError)).code,
      "forbidden",
    );
    await workspaces.updateWorkspaceMember(workspaceDeps, key(a), workspaceId, b.userId, {
      expected_version: 2,
      grants: limited,
    });
    if (withTask) {
      assertEquals(
        job.required_permissions.some((r: workspaces.WorkspaceRequirement) =>
          r.target_kind === "tasks" && r.access === "read"
        ),
        true,
      );
      assertEquals(
        job.required_permissions.some((r: workspaces.WorkspaceRequirement) =>
          r.target_kind === "tasks" && r.access === "write"
        ),
        false,
      );
      await workspaces.updateWorkspaceMember(workspaceDeps, key(a), workspaceId, b.userId, {
        expected_version: 3,
        grants: limited.filter((r) => r.target_kind !== "tasks"),
      });
      assertEquals((await worker`select app.claim_data_model_conversion() as batch`)[0].batch, null);
      assertEquals(
        (await assertRejects(() => getDataModelChange(modelDeps, executor, saved.id), AppError)).code,
        "forbidden",
      );
      assertEquals(
        (await assertRejects(() => applyDataModel(modelDeps, activation, saved.id, activationInput), AppError)).code,
        "forbidden",
      );
      await workspaces.updateWorkspaceMember(workspaceDeps, key(a), workspaceId, b.userId, {
        expected_version: 4,
        grants: limited,
      });
    }
    const [claim] = await worker`select app.claim_data_model_conversion() as batch`;
    assertEquals(Boolean(claim.batch?.child), true);
    const prepared = await prepareMigrationBatch(claim.batch.child, new Date());
    assertEquals(
      (await worker`select app.stage_data_model_conversion(${claim.batch.id},${claim.batch.fence},${claim.batch.child.id},${claim.batch.child.fence},${
        worker.json(prepared.results)
      }) as accepted`)[0].accepted,
      true,
    );
    const [committing] = await worker`select app.claim_data_model_conversion() as batch`;
    assertEquals(
      (await worker`select app.commit_data_model_conversion(${committing.batch.id},${committing.batch.fence},${SEARCH_PIPELINE}) as committed`)[
        0
      ].committed,
      true,
    );
    assertEquals((await getDataModelChange(modelDeps, executor, saved.id)).status, "applied");
  } finally {
    if (workspaceId) {
      await admin`delete from pgmq.q_search_index where message->>'workspace_id'=${workspaceId}`;
      await admin`delete from app.workspaces where id=${workspaceId}`;
    }
    for (const actor of [a, b]) await admin`delete from auth.users where id=${actor.userId}`;
  }
}

dbTest("linked peer read is sealed for conversion without requiring peer write", () => linkedReferenceFixture(false));
dbTest("linked task and peer reads are sealed without task or peer write", () => linkedReferenceFixture(true));

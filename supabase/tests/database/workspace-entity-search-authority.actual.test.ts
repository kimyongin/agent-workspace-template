import { assertEquals } from "@std/assert";
import { SqlEntityUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-store.ts";
import { SqlDataModelUnitOfWork } from "../../functions/_shared/adapters/supabase/data-model-store.ts";
import {
  applyDataModel,
  exportDataModel,
  prepareDataModel,
  previewDataModel,
} from "../../functions/_shared/core/data-model/application.ts";
import { SqlExternalEffectLedger } from "../../functions/_shared/adapters/supabase/external-effect.ts";
import { SqlIndexQueue } from "../../functions/_shared/adapters/supabase/index-queue.ts";
import { entityCreate } from "../../functions/_shared/contracts/entity.ts";
import * as entities from "../../functions/_shared/core/entity/application.ts";
import * as workspaces from "../../functions/_shared/core/workspaces/application.ts";
import { indexBatch, type IndexQueue } from "../../functions/_shared/core/search/index-worker.ts";
import { DurablePassageEmbedder } from "../../functions/_shared/core/search/passage-embedder.ts";
import { connect, dbTest, urls } from "./_db.ts";
import { businessRequest, businessWorkspaceFixture } from "./_workspace-business.ts";

const admin = connect(urls.admin, { max: 1 });
const user = connect(urls.pooler, { max: 3, prepare: false });
const workerUrl = new URL(urls.pooler);
workerUrl.username = "app_worker.pooler-dev";
workerUrl.password = encodeURIComponent(Deno.env.get("APP_WORKER_PASSWORD")!);
const worker = connect(workerUrl.href, { max: 3, prepare: false });
const deps = { uow: new SqlEntityUnitOfWork(user) };
const vector = Array.from({ length: 1024 }, (_, i) => i === 0 ? 1 : 0);
const stages = ["before_prepare", "before_send_claim", "provider_wait", "before_publish"] as const;
const changes = [
  "grant_read",
  "member_removed",
  "auth_deleted",
  "workspace_deleted",
  "workspace_restored",
  "source_edited",
] as const;

// Test barriers wrap the public orchestration ports, while every authority check,
// effect reservation and chunk publication still executes as the real app_worker.
for (const stage of stages) {
  for (const change of changes) {
    dbTest(`workspace entity worker authority: ${change} at ${stage} cannot publish old source`, async () => {
      const fixture = await businessWorkspaceFixture(admin, user);
      const ownedEffects: string[] = [];
      try {
        const kind = await fixture.createKind("자료 색인 권한 경계");
        await fixture.grantKind(fixture.manager, kind.id, "write");
        await fixture.grantKind(fixture.member, kind.id, "write");
        const model = { uow: new SqlDataModelUnitOfWork(user) };
        const document = await exportDataModel(model, fixture.manager);
        const definition = document.entity_types.find((item) => item.schema["x-type-id"] === kind.id)!;
        definition.schema.properties.prop_1["x-search-text"] = true;
        definition.schema.properties.prop_1.title = "검색본문";
        const input = { mode: "update", document: JSON.stringify(document) };
        const review = await previewDataModel(model, fixture.manager, input);
        const modelChange = await prepareDataModel(model, businessRequest(fixture.manager), {
          ...input,
          preview_fingerprint: review.fingerprint,
        });
        assertEquals(
          (await applyDataModel(model, businessRequest(fixture.manager), modelChange.id, {
            expected_version: modelChange.version,
          })).status,
          "applied",
        );
        const original = await entities.createEntity(
          deps,
          businessRequest(fixture.member),
          entityCreate.parse({
            entity_type_id: kind.id,
            schema_version: 2,
            properties: { prop_1: "오래된 자료 색인이 공개되면 안 되는 공유 원문" },
          }),
        );
        await fixture.grantKind(fixture.manager, kind.id, "read");
        const record = { id: original.id, version: original.version, body: `검색본문\n${original.properties.prop_1}` };
        let changed = 0;
        const mutate = async () => {
          assertEquals(++changed, 1);
          switch (change) {
            case "grant_read":
              await fixture.grantKind(fixture.member, kind.id, "read");
              break;
            case "member_removed":
              await workspaces.removeWorkspaceMember(
                fixture.workspaceDeps,
                businessRequest(fixture.manager),
                fixture.workspaceId,
                fixture.member.userId,
                { expected_version: 2 },
              );
              break;
            case "auth_deleted":
              // This is this test's freshly seeded Auth identity, never a dev account.
              await admin`delete from auth.users where id=${fixture.member.userId}`;
              break;
            case "workspace_deleted":
            case "workspace_restored": {
              const deleted = await workspaces.deleteWorkspace(
                fixture.workspaceDeps,
                businessRequest(fixture.manager),
                fixture.workspaceId,
                { expected_generation: 1 },
              );
              if (change === "workspace_restored") {
                await workspaces.restoreWorkspace(
                  fixture.workspaceDeps,
                  businessRequest(fixture.manager),
                  fixture.workspaceId,
                  { expected_generation: deleted.workspace.lifecycle_generation },
                );
              }
              break;
            }
            case "source_edited":
              await entities.updateEntity(deps, businessRequest(fixture.member), record.id, {
                expected_version: record.version,
                schema_version: 2,
                properties: { prop_1: "새로운 원문만 다음 자료 색인의 대상" },
              });
              break;
          }
        };
        const sqlQueue = new SqlIndexQueue(worker);
        const queue: IndexQueue = {
          async claim(scope) {
            const claims = await sqlQueue.claim(scope);
            assertEquals(claims.length, 1);
            if (stage === "before_prepare") await mutate();
            return claims;
          },
          async prepare(id, pipeline) {
            const source = await sqlQueue.prepare(id, pipeline);
            if (stage === "before_send_claim") await mutate();
            return source;
          },
          async finish(...args) {
            if (stage === "before_publish") await mutate();
            return await sqlQueue.finish(...args);
          },
        };
        let sends = 0;
        const result = await indexBatch(
          queue,
          new DurablePassageEmbedder(new SqlExternalEffectLedger(worker), {
            async send(text) {
              assertEquals(text, record.body);
              sends++;
              if (stage === "provider_wait") await mutate();
              return { state: "succeeded", vector };
            },
          }, "b".repeat(64)),
          { limit: 1, workspace_id: fixture.workspaceId, kind: "entity", id: record.id },
        );
        assertEquals(changed, 1);
        assertEquals(result.stale, 1);
        assertEquals(result.indexed, 0);
        assertEquals(sends, stage === "before_prepare" || stage === "before_send_claim" ? 0 : 1);
        const [chunks] = await admin`select count(*)::int as count from app.search_chunks
          where workspace_id=${fixture.workspaceId} and source_kind='entity' and source_id=${record.id}`;
        assertEquals(chunks.count, 0);
        const effects = await admin`select id,state,result is not null as has_result from private.passage_effects
          where workspace_id=${fixture.workspaceId} and source_kind='entity' and source_id=${record.id}`;
        ownedEffects.push(...effects.map((effect) => effect.id as string));
        // Known completed results may be pruned after source revision; uncertain sends must remain.
        const prunedCompleted = stage === "before_publish" && change === "source_edited";
        assertEquals(effects.length, prunedCompleted ? 0 : sends);
        for (const effect of effects) {
          assertEquals(effect.state, stage === "before_publish" ? "succeeded" : "running");
          assertEquals(effect.has_result, stage === "before_publish");
        }
        // Shared originals survive loss of the initiating member/Auth identity.
        if (change === "member_removed" || change === "auth_deleted" || change === "grant_read") {
          assertEquals(
            (await entities.getEntity(deps, fixture.manager, record.id)).properties.prop_1,
            original.properties.prop_1,
          );
        }
      } finally {
        // Capture before workspace deletion detaches retained ledgers. Only rows
        // created within this exact fresh workspace belong to this fixture.
        const remaining = await admin`select id from private.passage_effects where workspace_id=${fixture.workspaceId}`;
        for (const row of remaining) if (!ownedEffects.includes(row.id as string)) ownedEffects.push(row.id as string);
        for (const id of ownedEffects) await admin`delete from private.passage_effects where id=${id}`;
        await fixture.cleanup();
      }
    });
  }
}

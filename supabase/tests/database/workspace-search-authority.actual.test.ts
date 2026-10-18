import { assertEquals } from "@std/assert";
import { SqlUnitOfWork } from "../../functions/_shared/adapters/supabase/activity-store.ts";
import { SqlExternalEffectLedger } from "../../functions/_shared/adapters/supabase/external-effect.ts";
import { SqlIndexQueue } from "../../functions/_shared/adapters/supabase/index-queue.ts";
import { taskCreate } from "../../functions/_shared/contracts/task.ts";
import * as activity from "../../functions/_shared/core/activity/application.ts";
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
const deps = { uow: new SqlUnitOfWork(user), clock: { now: () => new Date() } };
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
    dbTest(`workspace worker authority: ${change} at ${stage} cannot publish old source`, async () => {
      const fixture = await businessWorkspaceFixture(admin, user);
      const ownedEffects: string[] = [];
      try {
        await fixture.grant(fixture.member, [{ target_kind: "tasks", target_id: "*", access: "write" }]);
        await fixture.grant(fixture.manager, [
          { target_kind: "settings", target_id: "*", access: "write" },
          { target_kind: "tasks", target_id: "*", access: "read" },
        ]);
        const task = await activity.createTask(
          deps,
          businessRequest(fixture.member),
          taskCreate.parse({
            kind: "once",
            title: "현재 처리 권한 검증",
          }),
        );
        const { record } = await activity.completeTask(deps, businessRequest(fixture.member), task.id, {
          expected_version: task.version,
          body: "오래된 색인이 공개되면 안 되는 공유 원문",
        });
        let changed = 0;
        const mutate = async () => {
          assertEquals(++changed, 1);
          switch (change) {
            case "grant_read":
              await fixture.grant(fixture.member, [{ target_kind: "tasks", target_id: "*", access: "read" }]);
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
              await activity.updateRecord(deps, businessRequest(fixture.member), record.id, {
                expected_version: record.version,
                body: "새로운 원문만 다음 색인의 대상",
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
          { limit: 1, workspace_id: fixture.workspaceId, kind: "record", id: record.id },
        );
        assertEquals(changed, 1);
        assertEquals(result.stale, 1);
        assertEquals(result.indexed, 0);
        assertEquals(sends, stage === "before_prepare" || stage === "before_send_claim" ? 0 : 1);
        const [chunks] = await admin`select count(*)::int as count from app.search_chunks
          where workspace_id=${fixture.workspaceId} and record_id=${record.id}`;
        assertEquals(chunks.count, 0);
        const effects = await admin`select id,state,result is not null as has_result from private.passage_effects
          where workspace_id=${fixture.workspaceId} and record_id=${record.id}`;
        ownedEffects.push(...effects.map((effect) => effect.id as string));
        assertEquals(effects.length, sends);
        for (const effect of effects) {
          assertEquals(effect.state, stage === "before_publish" ? "succeeded" : "running");
          assertEquals(effect.has_result, stage === "before_publish");
        }
        // Shared originals survive loss of the initiating member/Auth identity.
        if (change === "member_removed" || change === "auth_deleted" || change === "grant_read") {
          assertEquals((await activity.getRecord(deps, fixture.manager, record.id)).body, record.body);
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

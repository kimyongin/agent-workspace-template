import { assert, assertEquals } from "@std/assert";
import { SqlUnitOfWork } from "../../functions/_shared/adapters/supabase/activity-store.ts";
import { SqlExternalEffectLedger } from "../../functions/_shared/adapters/supabase/external-effect.ts";
import { SqlIndexQueue } from "../../functions/_shared/adapters/supabase/index-queue.ts";
import { taskCreate } from "../../functions/_shared/contracts/task.ts";
import * as activity from "../../functions/_shared/core/activity/application.ts";
import * as workspaces from "../../functions/_shared/core/workspaces/application.ts";
import { indexBatch, type IndexQueue } from "../../functions/_shared/core/search/index-worker.ts";
import { DurablePassageEmbedder, hashPassage } from "../../functions/_shared/core/search/passage-embedder.ts";
import { SEARCH_PIPELINE } from "../../functions/_shared/core/search/config.ts";
import { executePassageEffect } from "../../functions/_shared/core/search/external-effect.ts";
import { connect, dbTest, outcome, urls } from "./_db.ts";
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
          where workspace_id=${fixture.workspaceId} and source_kind='record' and source_id=${record.id}`;
        assertEquals(chunks.count, 0);
        const effects = await admin`select id,state,result is not null as has_result from private.passage_effects
          where workspace_id=${fixture.workspaceId} and source_kind='record' and source_id=${record.id}`;
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

async function passageFixture() {
  const fixture = await businessWorkspaceFixture(admin, user);
  try {
    await fixture.grant(fixture.member, [{ target_kind: "tasks", target_id: "*", access: "write" }]);
    const task = await activity.createTask(
      deps,
      businessRequest(fixture.member),
      taskCreate.parse({
        kind: "once",
        title: "확정되지 않은 전송 보존 검증",
      }),
    );
    const { record } = await activity.completeTask(deps, businessRequest(fixture.member), task.id, {
      expected_version: task.version,
      body: "외부 작업의 시도와 세대 경계",
    });
    const queue = new SqlIndexQueue(worker);
    const inputForCurrent = async () => {
      const claims = await queue.claim({ limit: 1, workspace_id: fixture.workspaceId, kind: "record", id: record.id });
      assertEquals(claims.length, 1);
      return {
        message_id: claims[0].msg_id,
        pipeline: SEARCH_PIPELINE,
        provider_scope: "c".repeat(64),
        model: "llama-text-embed-v2",
        dimensions: 1024,
        start: 0,
        end: [...record.body].length,
        input_hash: await hashPassage(record.body),
      };
    };
    return {
      ...fixture,
      record,
      inputForCurrent,
      ledger: new SqlExternalEffectLedger(worker),
      cleanup: async () => {
        const effects = await admin`select id from private.passage_effects where workspace_id=${fixture.workspaceId}`;
        for (const effect of effects) await admin`delete from private.passage_effects where id=${effect.id}`;
        await fixture.cleanup();
      },
    };
  } catch (error) {
    await fixture.cleanup();
    throw error;
  }
}

dbTest("workspace passage: unknown responses retain a durable five-send ceiling", async () => {
  const fixture = await passageFixture();
  try {
    const input = await fixture.inputForCurrent();
    let sends = 0;
    const provider = {
      send() {
        sends++;
        return Promise.reject(new Error("in-process uncertain response"));
      },
    };
    let effectId: string | undefined;
    for (let attempt = 1; attempt <= 5; attempt++) {
      const result = await executePassageEffect(fixture.ledger, provider, input, fixture.record.body);
      assertEquals(result.state, "unknown");
      assert("attempts" in result);
      assertEquals(result.attempts, attempt);
      assertEquals(sends, attempt);
      const [effect] = await admin`select id,attempts,state,result is null as no_result from private.passage_effects
        where workspace_id=${fixture.workspaceId} and source_kind='record' and source_id=${fixture.record.id}`;
      effectId = effect.id as string;
      assertEquals(effect.attempts, attempt);
      assertEquals(effect.state, "unknown");
      assertEquals(effect.no_result, true);
      // Exact owned effect only: advance its retry clock without waiting minutes.
      await admin`update private.passage_effects set next_attempt_at=clock_timestamp()-interval '1 second' where id=${effectId}`;
    }
    const held = await executePassageEffect(fixture.ledger, provider, input, fixture.record.body);
    assertEquals(held, { state: "unknown", reason: "retry_exhausted", attempts: 5 });
    assertEquals(sends, 5);
    const [retained] = await admin`select state,attempts,reason from private.passage_effects where id=${effectId!}`;
    assertEquals(retained, { state: "unknown", attempts: 5, reason: "retry_exhausted" });
  } finally {
    await fixture.cleanup();
  }
});

dbTest("workspace passage: expired lease fences old completion and new source cannot reuse cached vector", async () => {
  const fixture = await passageFixture();
  try {
    const input = await fixture.inputForCurrent();
    const first = await fixture.ledger.claim(input);
    assert(first.action === "send");
    await admin`update private.passage_effects set lease_until=clock_timestamp()-interval '1 second' where id=${first.effect_id}`;
    const second = await fixture.ledger.claim(input);
    assert(second.action === "send");
    assertEquals(second.effect_id, first.effect_id);
    assertEquals(second.fence, first.fence + 1);
    assertEquals(second.attempts, 2);
    assertEquals(await fixture.ledger.complete(first, { state: "succeeded", vector }), false);
    assertEquals(await fixture.ledger.complete(second, { state: "succeeded", vector }), true);
    const cached = await fixture.ledger.claim(input);
    assert(cached.action === "cached");
    assertEquals(cached.vector, vector);
    const changed = await activity.updateRecord(deps, businessRequest(fixture.member), fixture.record.id, {
      expected_version: fixture.record.version,
      body: "다른 본문으로 바꾼 뒤 다시 원문으로 되돌림",
    });
    await activity.updateRecord(deps, businessRequest(fixture.member), fixture.record.id, {
      expected_version: changed.version,
      body: fixture.record.body,
    });
    assertEquals((await fixture.ledger.claim(input)).action, "stale");
    const current = await fixture.ledger.claim(await fixture.inputForCurrent());
    assert(current.action === "send");
    assert(current.effect_id !== first.effect_id);
    assertEquals(current.attempts, 1);
  } finally {
    await fixture.cleanup();
  }
});

dbTest("workspace worker: public server and worker roles cannot bypass scoped RPC authority", async () => {
  const fixture = await passageFixture();
  try {
    assert((await outcome(worker`select body from app.records limit 1`)).startsWith("42501 "));
    assert((await outcome(worker`select result from private.passage_effects limit 1`)).startsWith("42501 "));
    assert((await outcome(user.begin(async (tx) => {
      await tx`set local role app_user`;
      await tx`select * from app.claim_search_index(1,${fixture.workspaceId}::uuid,'record',${fixture.record.id})`;
    }))).startsWith("42501 "));
  } finally {
    await fixture.cleanup();
  }
});

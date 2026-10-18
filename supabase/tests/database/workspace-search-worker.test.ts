import { assertEquals } from "@std/assert";
import { SqlUnitOfWork } from "../../functions/_shared/adapters/supabase/activity-store.ts";
import { SqlExternalEffectLedger } from "../../functions/_shared/adapters/supabase/external-effect.ts";
import { SqlIndexQueue } from "../../functions/_shared/adapters/supabase/index-queue.ts";
import { taskCreate } from "../../functions/_shared/contracts/task.ts";
import * as activity from "../../functions/_shared/core/activity/application.ts";
import { indexBatch } from "../../functions/_shared/core/search/index-worker.ts";
import { DurablePassageEmbedder } from "../../functions/_shared/core/search/passage-embedder.ts";
import { connect, dbTest, urls } from "./_db.ts";
import {
  businessRequest,
  businessWorkspaceFixture,
} from "./_workspace-business.ts";

const admin = connect(urls.admin, { max: 1 });
const user = connect(urls.pooler, { max: 3, prepare: false });
const workerUrl = new URL(urls.pooler);
workerUrl.username = "app_worker.pooler-dev";
workerUrl.password = encodeURIComponent(Deno.env.get("APP_WORKER_PASSWORD")!);
const worker = connect(workerUrl.href, { max: 3, prepare: false });
const deps = { uow: new SqlUnitOfWork(user), clock: { now: () => new Date() } };
const queue = new SqlIndexQueue(worker);
const ledger = new SqlExternalEffectLedger(worker);
const vector = Array.from({ length: 1024 }, (_, index) => index === 0 ? 1 : 0);

dbTest(
  "workspace worker: current initiator grant fences late provider success",
  async () => {
    const fixture = await businessWorkspaceFixture(admin, user);
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    let running: ReturnType<typeof indexBatch> | undefined;
    try {
      await fixture.grant(fixture.member, [{
        target_kind: "tasks",
        target_id: "*",
        access: "write",
      }]);
      await fixture.grant(fixture.manager, [
        { target_kind: "settings", target_id: "*", access: "write" },
        { target_kind: "tasks", target_id: "*", access: "read" },
      ]);
      const task = await activity.createTask(
        deps,
        businessRequest(fixture.member),
        taskCreate.parse({
          kind: "once",
          title: "권한 회수 중 자료 전송",
        }),
      );
      const { record } = await activity.completeTask(
        deps,
        businessRequest(fixture.member),
        task.id,
        {
          expected_version: task.version,
          body: "현재 권한으로만 처리하는 공유 기록",
        },
      );
      let sends = 0;
      const embedder = new DurablePassageEmbedder(ledger, {
        async send(text) {
          sends++;
          assertEquals(text, record.body);
          entered.resolve();
          await release.promise;
          return { state: "succeeded", vector };
        },
      }, "a".repeat(64));
      running = indexBatch(queue, embedder, {
        limit: 1,
        kind: "record",
        id: record.id,
      });
      // Surface claim/prepare failures without hanging at the fake provider barrier.
      await Promise.race([
        entered.promise,
        running.then((result) => {
          assertEquals(result.claimed, 1);
          assertEquals(result.stale, 0);
          throw new Error(
            "worker returned before reaching the in-process provider",
          );
        }),
      ]);
      // This must commit while provider I/O waits: no Auth/workspace/domain locks may span send.
      await fixture.grant(fixture.member, []);
      release.resolve();
      assertEquals((await running).stale, 1);
      assertEquals(sends, 1);
      // Losing initiator authority does not erase the shared original for another current reader.
      assertEquals(
        (await activity.getRecord(deps, fixture.manager, record.id)).body,
        record.body,
      );
      // Neither a fresh queue attempt nor a cached vector may revive the revoked generation.
      assertEquals(
        (await indexBatch(queue, embedder, {
          limit: 1,
          kind: "record",
          id: record.id,
        })).indexed,
        0,
      );
      assertEquals(sends, 1);
    } finally {
      release.resolve();
      await running?.catch(() => {});
      // Only this fixture's in-process fake sends are cleaned up; production
      // uncertain effects remain retained by the worker protocol.
      const ownedEffects =
        await admin`select id from private.passage_effects where workspace_id=${fixture.workspaceId}`;
      for (const effect of ownedEffects) {
        await admin`delete from private.passage_effects where id=${effect.id}::uuid`;
      }
      await fixture.cleanup();
    }
  },
);

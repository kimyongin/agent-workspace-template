import { assert, assertEquals, assertRejects } from "@std/assert";
import { runWorkspaceCleanup } from "../../../scripts/workspace-fixture-cleanup.mjs";
import { SqlUnitOfWork } from "../../functions/_shared/adapters/supabase/activity-store.ts";
import { SqlExternalEffectLedger } from "../../functions/_shared/adapters/supabase/external-effect.ts";
import { SqlIndexQueue } from "../../functions/_shared/adapters/supabase/index-queue.ts";
import { taskCreate } from "../../functions/_shared/contracts/task.ts";
import * as activity from "../../functions/_shared/core/activity/application.ts";
import { indexBatch } from "../../functions/_shared/core/search/index-worker.ts";
import { DurablePassageEmbedder } from "../../functions/_shared/core/search/passage-embedder.ts";
import { connect, dbTest, urls } from "./_db.ts";
import { businessRequest, businessWorkspaceFixture } from "./_workspace-business.ts";

const admin = connect(urls.admin, { max: 1 });
const user = connect(urls.direct, { max: 3, prepare: false });
const workerUrl = new URL(urls.direct);
workerUrl.username = "app_worker";
workerUrl.password = Deno.env.get("APP_WORKER_PASSWORD")!;
const worker = connect(workerUrl.href, { max: 1, prepare: false });
const deps = { uow: new SqlUnitOfWork(user), clock: { now: () => new Date() } };

dbTest(
  "owned workspace cleanup: digest fences mutations, exact fake effects disappear, unrelated data and Auth survive retry",
  async () => {
    const source = Deno.env.get("WORKSPACE_CLEANUP_SOURCE_REVISION");
    const project = Deno.env.get("WORKSPACE_CLEANUP_PROJECT_ID");
    assert(source && /^[a-f0-9]{40}$/.test(source), "explicit tested source required");
    assert(project, "explicit isolated project required");
    const beforeAuth = await admin`select id,raw_user_meta_data,raw_app_meta_data from auth.users order by id`;
    const beforeHistory =
      await admin`select id,state,workspace_id from private.passage_effects where workspace_id is null order by id`;
    const fixture = await businessWorkspaceFixture(admin, user);
    try {
      const foreign = await fixture.addWorkspace("정리에서 보존할 다른 공간");
      for (const actor of [fixture.manager, foreign.manager]) {
        await fixture.grant(actor, [
          { target_kind: "settings", target_id: "*", access: "write" },
          { target_kind: "tasks", target_id: "*", access: "write" },
        ]);
      }
      const task = await activity.createTask(
        deps,
        businessRequest(fixture.manager),
        taskCreate.parse({ kind: "once", title: "정리할 할 일" }),
      );
      const completed = await activity.completeTask(deps, businessRequest(fixture.manager), task.id, {
        expected_version: task.version,
        body: "정리할 수행 결과",
      });
      const sentinel = await activity.createTask(
        deps,
        businessRequest(foreign.manager),
        taskCreate.parse({ kind: "once", title: "보존할 할 일" }),
      );
      let sends = 0;
      const fake = new DurablePassageEmbedder(new SqlExternalEffectLedger(worker), {
        send() {
          sends++;
          return Promise.resolve({ state: "unknown", reason: "provider_unknown" });
        },
      }, "b".repeat(64));
      assertEquals(
        (await indexBatch(new SqlIndexQueue(worker), fake, {
          limit: 1,
          workspace_id: fixture.workspaceId,
          kind: "record",
          id: completed.record.id,
        })).retry,
        1,
      );
      assertEquals(sends, 1);
      const [effect] = await admin`select id from private.passage_effects where workspace_id=${fixture.workspaceId}`;
      assert(effect);
      const [root] = await admin`select id,name,created_by from app.workspaces where id=${fixture.workspaceId}`;
      const target = new URL(urls.admin);
      const manifest = {
        run_id: crypto.randomUUID(),
        source_revision: source,
        project_id: project,
        environment: {
          name: "owned-cleanup-test",
          host: target.hostname,
          port: Number(target.port),
          database: target.pathname.slice(1),
        },
        workspace: root,
        member_ids: [fixture.manager.userId, fixture.member.userId],
        disposable_effect_ids: [] as string[],
      };
      const blocked = await runWorkspaceCleanup(admin, manifest);
      assertEquals(blocked.blockers, [{ reason: "unresolved_effect", id: effect.id }]);
      await assertRejects(() => runWorkspaceCleanup(admin, manifest, blocked), Error, "blocked");
      manifest.disposable_effect_ids.push(effect.id);
      const stale = await runWorkspaceCleanup(admin, manifest);
      await activity.createTask(
        deps,
        businessRequest(fixture.manager),
        taskCreate.parse({ kind: "once", title: "계획 이후 추가한 할 일" }),
      );
      await assertRejects(() => runWorkspaceCleanup(admin, manifest, stale), Error, "digest changed");
      assertEquals((await activity.getTask(deps, fixture.manager, task.id)).title, task.title);
      const fresh = await runWorkspaceCleanup(admin, manifest);
      assertEquals(fresh.blockers, []);
      assert(fresh.counts["app.records"] > 0);
      assertEquals(fresh.effect_ids, [effect.id]);
      assert(fresh.counts["private.workspace_request_results"] > 0);
      const applied = await runWorkspaceCleanup(admin, manifest, fresh);
      assertEquals(applied.mode, "applied");
      assertEquals(applied.residual_rows, 0);
      assertEquals((await runWorkspaceCleanup(admin, manifest, fresh)).mode, "already-clean");
      assertEquals((await activity.getTask(deps, foreign.manager, sentinel.id)).title, sentinel.title);
      assertEquals((await admin`select id from private.passage_effects where id=${effect.id}`).length, 0);
      assertEquals(
        await admin`select id,state,workspace_id from private.passage_effects where workspace_id is null order by id`,
        beforeHistory,
      );
    } finally {
      await fixture.cleanup();
    }
    assertEquals(await admin`select id,raw_user_meta_data,raw_app_meta_data from auth.users order by id`, beforeAuth);
    assertEquals(
      await admin`select id,state,workspace_id from private.passage_effects where workspace_id is null order by id`,
      beforeHistory,
    );
  },
);

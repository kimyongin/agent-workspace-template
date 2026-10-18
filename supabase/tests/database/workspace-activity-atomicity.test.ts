import { assertEquals, assertRejects } from "@std/assert";
import * as activity from "../../functions/_shared/core/activity/application.ts";
import * as tags from "../../functions/_shared/core/tags/application.ts";
import {
  taskComplete,
  taskCreate,
} from "../../functions/_shared/contracts/task.ts";
import {
  occurrenceRecordCreate,
  recordListQuery,
} from "../../functions/_shared/contracts/record.ts";
import { SqlUnitOfWork } from "../../functions/_shared/adapters/supabase/activity-store.ts";
import { SqlTagUnitOfWork } from "../../functions/_shared/adapters/supabase/tag-store.ts";
import { AppError } from "../../functions/_shared/core/shared/errors.ts";
import type { Actor } from "../../functions/_shared/core/shared/actor.ts";
import type { IndexJob } from "../../functions/_shared/core/shared/store.ts";
import {
  businessRequest,
  businessWorkspaceFixture,
} from "./_workspace-business.ts";
import { connect, dbTest, urls } from "./_db.ts";

const admin = connect(urls.admin, { max: 1 });
const sql = connect(urls.direct, { max: 1, prepare: false });
const uow = new SqlUnitOfWork(sql);
const deps = { uow, clock: { now: () => new Date("2026-10-04T12:00:00Z") } };
const tagDeps = { uow: new SqlTagUnitOfWork(sql) };

// The public UnitOfWork port keeps real SQL, permissions, ledger and producer.
// Only the final downstream failure is supplied by this boundary decorator.
function failingProducer(reached: () => void): activity.ActivityDeps {
  return {
    ...deps,
    uow: {
      run: (actor, execute, entry) =>
        uow.run(actor, (store) =>
          execute(
            new Proxy(store, {
              get(target, property) {
                if (property === "enqueueIndex") {
                  return async (job: IndexJob) => {
                    await target.enqueueIndex(job);
                    reached();
                    throw new AppError(
                      "unavailable",
                      "테스트의 후단 처리 실패",
                    );
                  };
                }
                const value = Reflect.get(target, property, target);
                return typeof value === "function" ? value.bind(target) : value;
              },
            }),
          ), entry),
    },
  };
}

async function storedFootprint(workspaceId: string) {
  return {
    records:
      await admin`select * from app.records where workspace_id=${workspaceId} order by id`,
    state:
      await admin`select * from app.search_index_state where workspace_id=${workspaceId} order by kind,id`,
    queue:
      await admin`select msg_id,message from pgmq.q_search_index where message->>'workspace_id'=${workspaceId} order by msg_id`,
  };
}
async function noReceipt(actor: Actor) {
  assertEquals(
    (await admin`select count(*)::int n from private.workspace_request_results
    where workspace_id=${actor
      .workspaceId!} and executor_id=${actor.userId} and request_key=${
      actor.request!.key
    }`)[0].n,
    0,
  );
}

dbTest(
  "workspace completion occurrence and saved result tags roll back a real late producer failure",
  async () => {
    const f = await businessWorkspaceFixture(admin, sql);
    try {
      await f.grant(f.member, [{
        target_kind: "tasks",
        target_id: "*",
        access: "write",
      }]);
      const once = await activity.createTask(
        deps,
        businessRequest(f.member),
        taskCreate.parse({ kind: "once", title: "원자적 완료" }),
      );
      const recurring = await activity.createTask(
        deps,
        businessRequest(f.member),
        taskCreate.parse({
          kind: "recurring",
          title: "원자적 회차",
          timezone: "UTC",
          recurrence: { freq: "daily", starts_on: "2026-10-01" },
        }),
      );
      const onceBefore = await activity.getTask(deps, f.member, once.id);
      const recurringBefore = await activity.getTask(
        deps,
        f.member,
        recurring.id,
      );
      let reached = 0;
      const failure = failingProducer(() => reached++);
      const completionRequest = businessRequest(f.member);
      const completionInput = taskComplete.parse({
        expected_version: once.version,
        body: "완료 결과 전체 원자성",
      });
      const beforeCompletion = await storedFootprint(f.workspaceId);
      assertEquals(
        (await assertRejects(() =>
          activity.completeTask(
            failure,
            completionRequest,
            once.id,
            completionInput,
          ), AppError)).code,
        "unavailable",
      );
      assertEquals(reached, 1);
      assertEquals(await activity.getTask(deps, f.member, once.id), onceBefore);
      assertEquals(await storedFootprint(f.workspaceId), beforeCompletion);
      await noReceipt(completionRequest);
      const completed = await activity.completeTask(
        deps,
        completionRequest,
        once.id,
        completionInput,
      );
      assertEquals(completed.task.status, "done");
      assertEquals(
        await activity.completeTask(
          deps,
          completionRequest,
          once.id,
          completionInput,
        ),
        completed,
      );

      const occurrenceRequest = businessRequest(f.member);
      const occurrenceInput = occurrenceRecordCreate.parse({
        body: "회차 결과 전체 원자성",
      });
      const beforeOccurrence = await storedFootprint(f.workspaceId);
      assertEquals(
        (await assertRejects(() =>
          activity.recordOccurrence(
            failure,
            occurrenceRequest,
            recurring.id,
            "2026-10-03",
            occurrenceInput,
          ), AppError)).code,
        "unavailable",
      );
      assertEquals(reached, 2);
      assertEquals(
        await activity.getTask(deps, f.member, recurring.id),
        recurring,
      );
      assertEquals(await storedFootprint(f.workspaceId), beforeOccurrence);
      assertEquals(
        (await activity.listOccurrences(deps, f.member, recurring.id, {
          from: "2026-10-03",
          to: "2026-10-03",
        })).items[0].record_ids,
        [],
      );
      await noReceipt(occurrenceRequest);
      const occurrence = await activity.recordOccurrence(
        deps,
        occurrenceRequest,
        recurring.id,
        "2026-10-03",
        occurrenceInput,
      );
      assertEquals(
        await activity.recordOccurrence(
          deps,
          occurrenceRequest,
          recurring.id,
          "2026-10-03",
          occurrenceInput,
        ),
        occurrence,
      );

      const tag = await tags.createTag(tagDeps, businessRequest(f.member), {
        scope: "record",
        name: "원자적 결과 분류",
      });
      let tagWrites = 0;
      const failingTags: tags.TagDeps = {
        uow: {
          run: (actor, execute, entry) =>
            tagDeps.uow.run(actor, (store) =>
              execute(
                new Proxy(store, {
                  get(target, property) {
                    if (property === "setTags") {
                      return async (use: tags.TagUse, ids: string[]) => {
                        await target.setTags(use, ids);
                        tagWrites++;
                        throw new AppError(
                          "unavailable",
                          "테스트의 분류 후단 처리 실패",
                        );
                      };
                    }
                    const value = Reflect.get(target, property, target);
                    return typeof value === "function"
                      ? value.bind(target)
                      : value;
                  },
                }),
              ), entry),
        },
      };
      const tagRequest = businessRequest(f.member);
      const tagInput = {
        target_kind: "record",
        target_id: completed.record.id,
        expected_version: completed.record.version,
        tag_ids: [tag.id],
      };
      const beforeTags = await storedFootprint(f.workspaceId);
      assertEquals(
        (await assertRejects(
          () => tags.setTagConnections(failingTags, tagRequest, tagInput),
          AppError,
        ))
          .code,
        "unavailable",
      );
      assertEquals(tagWrites, 1);
      assertEquals(
        await activity.getRecord(deps, f.member, completed.record.id),
        completed.record,
      );
      assertEquals(await storedFootprint(f.workspaceId), beforeTags);
      await noReceipt(tagRequest);
      const connected = await tags.setTagConnections(
        tagDeps,
        tagRequest,
        tagInput,
      );
      assertEquals(connected.tag_ids, [tag.id]);
      assertEquals(
        await tags.setTagConnections(tagDeps, tagRequest, tagInput),
        connected,
      );
      assertEquals(
        (await activity.listRecords(
          deps,
          f.member,
          recordListQuery.parse({ task_id: once.id, record_kind: "result" }),
        )).items.length,
        1,
      );
    } finally {
      await f.cleanup();
    }
  },
);

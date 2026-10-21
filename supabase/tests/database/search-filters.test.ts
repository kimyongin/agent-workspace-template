import { assert, assertEquals, assertRejects } from "@std/assert";
import { SqlSearchUnitOfWork } from "../../functions/_shared/adapters/supabase/search-store.ts";
import { SqlUnitOfWork } from "../../functions/_shared/adapters/supabase/activity-store.ts";
import { SqlTagUnitOfWork } from "../../functions/_shared/adapters/supabase/tag-store.ts";
import * as tags from "../../functions/_shared/core/tags/application.ts";
import { SqlEntityUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-store.ts";
import { entityCreate, entityUpdate } from "../../functions/_shared/contracts/entity.ts";
import { taskCreate } from "../../functions/_shared/contracts/task.ts";
import { recordListQuery } from "../../functions/_shared/contracts/record.ts";
import { searchInput } from "../../functions/_shared/contracts/search.ts";
import * as activity from "../../functions/_shared/core/activity/application.ts";
import * as entities from "../../functions/_shared/core/entity/application.ts";
import { search } from "../../functions/_shared/core/search/application.ts";
import { connect, dbTest, urls } from "./_db.ts";
import { businessRequest, businessWorkspaceFixture } from "./_workspace-business.ts";
const admin = connect(urls.admin, { max: 1 }), sql = connect(urls.pooler, { prepare: false, max: 2 });
const d = { uow: new SqlSearchUnitOfWork(sql) };
const activityDeps = { uow: new SqlUnitOfWork(sql), clock: { now: () => new Date() } };

dbTest(
  "search actual SQL filters current task states and immutable record parents before coverage/anchor/cursor",
  async () => {
    const f = await businessWorkspaceFixture(admin, sql);
    try {
      await f.grant(f.member, [{ target_kind: "tasks", target_id: "*", access: "write" }]);
      const token = crypto.randomUUID(), actor = f.member;
      const kind = await f.createKind("검색 조건 자료");
      await f.grantKind(actor, kind.id, "write");
      const entityDeps = { uow: new SqlEntityUnitOfWork(sql) };
      const tagDeps = { uow: new SqlTagUnitOfWork(sql) };
      const tag =
        (await tags.createTag(tagDeps, businessRequest(actor), { scope: "record", name: "조건 검증 원본" })).id;
      const entity = await entities.createEntity(
        entityDeps,
        businessRequest(actor),
        entityCreate.parse({
          entity_type_id: kind.id,
          schema_version: 1,
          properties: { prop_1: "원본" },
        }),
      );
      const open = await activity.createTask(
        activityDeps,
        businessRequest(actor),
        taskCreate.parse({ kind: "once", title: token }),
      );
      const pending = await activity.createTask(
        activityDeps,
        businessRequest(actor),
        taskCreate.parse({
          kind: "once",
          title: token,
          entity_ids: [entity.id],
        }),
      );
      const completed = await activity.completeTask(activityDeps, businessRequest(actor), pending.id, {
        expected_version: pending.version,
        body: token,
      });
      const recurring = await activity.createTask(
        activityDeps,
        businessRequest(actor),
        taskCreate.parse({
          kind: "recurring",
          title: token,
          recurrence: { freq: "daily", starts_on: "2026-01-01" },
          timezone: "Asia/Seoul",
        }),
      );
      await entities.updateEntity(
        entityDeps,
        businessRequest(actor),
        entity.id,
        entityUpdate.parse({
          expected_version: entity.version,
          schema_version: 1,
          properties: { prop_1: "수정" },
          change_note: token,
          change_tag_ids: [tag],
        }),
      );
      const changes = await activity.listRecords(
        activityDeps,
        actor,
        recordListQuery.parse({ entity_id: entity.id, record_kind: "change" }),
      );
      const change = changes.items.find((item) => item.body === token)!;
      assert(change);
      await tags.setTagConnections(tagDeps, businessRequest(actor), {
        target_kind: "record",
        target_id: completed.record.id,
        expected_version: completed.record.version,
        tag_ids: [tag],
      });
      assertEquals(completed.record.entity_id, null);
      assertEquals(change.task_id, null);
      const q = (extra: { kinds?: readonly string[]; [key: string]: unknown }) =>
        searchInput.parse({
          query: token,
          mode: "keyword",
          ...(extra.kinds?.[0] === "record" ? { tag_id: tag } : {}),
          ...extra,
        });
      for (
        const [extra, expected] of [
          [{ kinds: ["task"], task_kind: "recurring" }, [recurring.id]],
          [{ kinds: ["task"], task_status: "done" }, [completed.task.id]],
          [{ kinds: ["record"], record_kind: "change" }, [change.id]],
          [{ kinds: ["record"], record_kind: "result" }, [completed.record.id]],
          [{ kinds: ["record"], entity_id: entity.id }, [change.id]],
        ] as const
      ) {
        const result = await search(d, actor, q(extra));
        assertEquals(result.items.map((r) => r.id), [...expected]);
        assertEquals(result.semantic_coverage, {
          pending: extra.kinds[0] === "record" ? 1 : 0,
          excluded: 0,
          failed: 0,
        });
        assertEquals(
          (await search(d, actor, q({ ...extra, anchor: { kind: "task", id: open.id } }))).anchor_page,
          null,
        );
      }
      const page = await search(d, actor, q({ kinds: ["task"], task_kind: "once", limit: 1 }));
      assert(page.next_cursor);
      await assertRejects(() =>
        search(d, actor, q({ kinds: ["task"], task_kind: "recurring", limit: 1, cursor: page.next_cursor }))
      );
      await f.grantKind(actor, kind.id, "none");
      const readable = await search(d, actor, q({ kinds: ["record"] }));
      assertEquals(readable.items.map((item) => item.id), [completed.record.id]);
      assertEquals(readable.semantic_coverage, { pending: 1, excluded: 0, failed: 0 });
    } finally {
      await f.cleanup();
    }
  },
);

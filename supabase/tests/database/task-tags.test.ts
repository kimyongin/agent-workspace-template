import { requestActor } from "../_request.ts";
import { assertEquals, assertRejects } from "@std/assert";
import { SqlUnitOfWork } from "../../functions/_shared/adapters/supabase/activity-store.ts";
import { SqlTagUnitOfWork } from "../../functions/_shared/adapters/supabase/tag-store.ts";
import { taskCreate, taskListQuery, taskUpdate } from "../../functions/_shared/contracts/task.ts";
import { tagConnectionInput } from "../../functions/_shared/contracts/tag-connection.ts";
import { createTask, getTask, listTasks, updateTask } from "../../functions/_shared/core/activity/application.ts";
import { createTag, deleteTag, setTagConnections } from "../../functions/_shared/core/tags/application.ts";
import { AppError } from "../../functions/_shared/core/shared/errors.ts";
import { connect, dbTest, urls } from "./_db.ts";
import { businessWorkspaceFixture } from "./_workspace-business.ts";
const admin = connect(urls.admin, { max: 1 }), sql = connect(urls.pooler, { max: 3, prepare: false });
const deps = { uow: new SqlUnitOfWork(sql), clock: { now: () => new Date() } };
const tags = { uow: new SqlTagUnitOfWork(sql) };
const taskGrants = [
  { target_kind: "settings", target_id: "*", access: "write" },
  { target_kind: "tasks", target_id: "*", access: "write" },
] as const;

dbTest("할 일 태그: 저장 후 독립 연결과 회차 날짜·태그 결합 필터", async () => {
  const fixture = await businessWorkspaceFixture(admin, sql), actor = fixture.manager;
  try {
    await fixture.grant(actor, [...taskGrants]);
    const tag = await createTag(tags, requestActor(actor), { scope: "task", name: "회차 분류" });
    const base = {
      kind: "recurring",
      title: "매일",
      recurrence: { freq: "daily", starts_on: "2020-01-01" },
      timezone: "Asia/Seoul",
    };
    const saved = await createTask(deps, requestActor(actor), taskCreate.parse(base));
    assertEquals(saved.tag_ids, []);
    await setTagConnections(tags, requestActor(actor), {
      target_kind: "task",
      target_id: saved.id,
      expected_version: saved.version,
      tag_ids: [tag.id],
    });
    await createTask(deps, requestActor(actor), taskCreate.parse(base));
    const query = taskListQuery.parse({ occurrence_on: "2020-01-01", tag_id: tag.id });
    assertEquals((await listTasks(deps, actor, query)).items.map((task) => task.id), [saved.id]);
  } finally {
    await fixture.cleanup();
  }
});

dbTest("할 일 태그: 내용 편집은 독립 연결을 보존하고 해제·재연결·사전 삭제는 본문을 보존한다", async () => {
  const fixture = await businessWorkspaceFixture(admin, sql), actor = fixture.manager;
  try {
    await fixture.grant(actor, [...taskGrants]);
    const tag = await createTag(tags, requestActor(actor), { scope: "task", name: "업무 분류" });
    const saved = await createTask(
      deps,
      requestActor(actor),
      taskCreate.parse({ kind: "once", title: "태그 업무", body: "본문" }),
    );
    const linked = await setTagConnections(tags, requestActor(actor), {
      target_kind: "task",
      target_id: saved.id,
      expected_version: saved.version,
      tag_ids: [tag.id],
    });
    assertEquals((await listTasks(deps, actor, taskListQuery.parse({ tag_id: tag.id }))).items.map((task) => task.id), [
      saved.id,
    ]);
    const edited = await updateTask(
      deps,
      requestActor(actor),
      saved.id,
      taskUpdate.parse({ expected_version: linked.version, body: "정정" }),
    );
    assertEquals(edited.tag_ids, [tag.id]);
    const unlinked = await setTagConnections(tags, requestActor(actor), {
      target_kind: "task",
      target_id: saved.id,
      expected_version: edited.version,
      tag_ids: [],
    });
    const relinked = await setTagConnections(tags, requestActor(actor), {
      target_kind: "task",
      target_id: saved.id,
      expected_version: unlinked.version,
      tag_ids: [tag.id],
    });
    await deleteTag(tags, requestActor(actor), tag.id, tag.version);
    const after = await getTask(deps, actor, saved.id);
    assertEquals(after.tag_ids, []);
    assertEquals(after.body, "정정");
    assertEquals(after.version, relinked.version + 1);
    assertEquals(
      (await admin`select msg_id from pgmq.q_search_index where message->>'workspace_id'=${fixture.workspaceId} and message->>'id'=${saved.id}`)
        .length,
      0,
    );
  } finally {
    await fixture.cleanup();
  }
});

dbTest("할 일 태그: 교차 공간·없는 태그·구 입력·중복·10개 초과 거절 후 저장된 대상 보존", async () => {
  const fixture = await businessWorkspaceFixture(admin, sql), actor = fixture.manager;
  try {
    const foreign = await fixture.addWorkspace("다른 분류 공간");
    await fixture.grant(actor, [...taskGrants]);
    await fixture.grant(foreign.manager, [...taskGrants]);
    const tag = await createTag(tags, requestActor(foreign.manager), { scope: "task", name: "다른 공간 태그" });
    const saved = await createTask(deps, requestActor(actor), taskCreate.parse({ kind: "once", title: "보존" }));
    for (const id of [tag.id, "20261011-ZZZZZZZZ"]) {
      await assertRejects(
        () =>
          setTagConnections(tags, requestActor(actor), {
            target_kind: "task",
            target_id: saved.id,
            expected_version: saved.version,
            tag_ids: [id],
          }),
        AppError,
      );
    }
    assertEquals(taskCreate.safeParse({ kind: "once", title: "거부", tag_ids: [tag.id] }).success, false);
    assertEquals(
      taskUpdate.safeParse({ expected_version: saved.version, body: "변경", tag_ids: [tag.id] }).success,
      false,
    );
    const after = await getTask(deps, actor, saved.id);
    assertEquals([after.version, after.body, after.tag_ids], [saved.version, "", []]);
    const input = { target_kind: "task", target_id: saved.id, expected_version: saved.version };
    assertEquals(tagConnectionInput.safeParse({ ...input, tag_ids: [tag.id, tag.id] }).success, false);
    assertEquals(
      tagConnectionInput.safeParse({
        ...input,
        tag_ids: Array.from({ length: 11 }, (_, index) => "20261011-" + String(index).padStart(8, "0")),
      })
        .success,
      false,
    );
  } finally {
    await fixture.cleanup();
  }
});

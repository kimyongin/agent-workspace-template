import { assertEquals, assertRejects } from "@std/assert";
import { SqlUnitOfWork } from "../../functions/_shared/adapters/supabase/activity-store.ts";
import { SqlTagUnitOfWork } from "../../functions/_shared/adapters/supabase/tag-store.ts";
import { taskCreate, taskListQuery, taskUpdate } from "../../functions/_shared/contracts/task.ts";
import { tagCreate } from "../../functions/_shared/contracts/tag.ts";
import { createTask, getTask, listTasks, updateTask } from "../../functions/_shared/core/activity/application.ts";
import { createTag, deleteTag } from "../../functions/_shared/core/tags/application.ts";
import { AppError } from "../../functions/_shared/core/shared/errors.ts";
import { connect, dbTest, devUsers, urls } from "./_db.ts";
const admin = connect(urls.admin, { max: 1 }), sql = connect(urls.pooler, { max: 3, prepare: false });
const users = await devUsers(admin), A = { userId: users.a }, B = { userId: users.b };
const deps = { uow: new SqlUnitOfWork(sql), clock: { now: () => new Date() } },
  tags = { uow: new SqlTagUnitOfWork(sql) };

dbTest("할 일 태그: 회차 날짜와 태그 결합 필터", async () => {
  const tag = await createTag(tags, A, tagCreate.parse({ name: crypto.randomUUID().slice(0, 30) }));
  const base = {
    kind: "recurring",
    title: "매일",
    summary: "필터",
    recurrence: { freq: "daily", starts_on: "2020-01-01" },
    timezone: "Asia/Seoul",
  };
  const tagged = await createTask(deps, A, taskCreate.parse({ ...base, tag_ids: [tag.id] }));
  await createTask(deps, A, taskCreate.parse(base));
  const q = taskListQuery.parse({ occurrence_on: "2020-01-01", tag_id: tag.id });
  assertEquals((await listTasks(deps, A, q)).items.map((t) => t.id), [tagged.id]);
});
dbTest("할 일 태그: 필터·부분 수정·삭제 후 원문·색인 보존", async () => {
  const tag = await createTag(tags, A, tagCreate.parse({ name: crypto.randomUUID().slice(0, 30) }));
  const task = await createTask(
    deps,
    A,
    taskCreate.parse({ kind: "once", title: "태그 업무", summary: "판단", body: "본문", tag_ids: [tag.id] }),
  );
  assertEquals(task.tag_ids, [tag.id]);
  assertEquals((await listTasks(deps, A, taskListQuery.parse({ tag_id: tag.id }))).items.map((t) => t.id), [task.id]);
  await updateTask(
    deps,
    A,
    task.id,
    taskUpdate.parse({ change_note: "테스트 변경 이유", expected_version: 1, body: "정정" }),
  );
  assertEquals((await getTask(deps, A, task.id)).tag_ids, [tag.id]);
  await updateTask(
    deps,
    A,
    task.id,
    taskUpdate.parse({ change_note: "테스트 변경 이유", expected_version: 2, tag_ids: [] }),
  );
  await updateTask(
    deps,
    A,
    task.id,
    taskUpdate.parse({ change_note: "테스트 변경 이유", expected_version: 3, tag_ids: [tag.id] }),
  );
  await deleteTag(tags, A, tag.id, 1);
  const after = await getTask(deps, A, task.id);
  assertEquals(after.tag_ids, []);
  assertEquals(after.body, "정정");
  assertEquals(after.version, 5);
  assertEquals((await admin`select msg_id from pgmq.q_search_index where message->>'id'=${task.id}`).length, 1);
});
dbTest("할 일 태그: 다른 소유자·없는 태그·중복·10개 초과 거부와 롤백", async () => {
  const foreign = await createTag(tags, B, tagCreate.parse({ name: crypto.randomUUID().slice(0, 30) }));
  for (const id of [foreign.id, crypto.randomUUID()]) {
    await assertRejects(
      () => createTask(deps, A, taskCreate.parse({ kind: "once", title: "거부", summary: "격리", tag_ids: [id] })),
      AppError,
    );
  }
  const task = await createTask(deps, A, taskCreate.parse({ kind: "once", title: "보존", summary: "격리" }));
  await assertRejects(
    () =>
      updateTask(
        deps,
        A,
        task.id,
        taskUpdate.parse({ change_note: "테스트 변경 이유", expected_version: 1, body: "변경", tag_ids: [foreign.id] }),
      ),
    AppError,
  );
  assertEquals((await getTask(deps, A, task.id)).version, 1);
  assertEquals((await getTask(deps, A, task.id)).body, "");
  assertEquals(
    taskUpdate.safeParse({ change_note: "테스트 변경 이유", expected_version: 1, tag_ids: [foreign.id, foreign.id] })
      .success,
    false,
  );
  assertEquals(
    taskUpdate.safeParse({
      change_note: "테스트 변경 이유",
      expected_version: 1,
      tag_ids: Array.from({ length: 11 }, () => crypto.randomUUID()),
    })
      .success,
    false,
  );
});

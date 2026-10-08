import { assertEquals, assertRejects } from "@std/assert";
import { connect, dbTest, fixtureOwner, urls } from "./_db.ts";
import { SqlBusinessSettingsUnitOfWork } from "../../functions/_shared/adapters/supabase/business-settings-store.ts";
import { SqlUnitOfWork } from "../../functions/_shared/adapters/supabase/activity-store.ts";
import { SqlTagUnitOfWork } from "../../functions/_shared/adapters/supabase/tag-store.ts";
import {
  getBusinessSettings,
  prepareBusinessRecord,
  updateBusinessSettings,
} from "../../functions/_shared/core/settings/application.ts";
import { createTask, getRecord, listRecords, updateRecord } from "../../functions/_shared/core/activity/application.ts";
import { createTag, deleteTag } from "../../functions/_shared/core/tags/application.ts";
import { recordListQuery } from "../../functions/_shared/contracts/record.ts";
import { taskCreate } from "../../functions/_shared/contracts/task.ts";
import { AppError } from "../../functions/_shared/core/shared/errors.ts";

dbTest("설정 ID별 첫 저장·버전 격리와 같은 ID의 동시 저장 충돌", async () => {
  const admin = connect(urls.admin), sql = connect(urls.direct, { max: 3 });
  const own = await fixtureOwner(admin), first = await fixtureOwner(admin);
  const settings = { uow: new SqlBusinessSettingsUnitOfWork(sql), clock: { now: () => new Date() } };
  try {
    await Promise.all([
      updateBusinessSettings(settings, own.actor, {
        id: "record_templates",
        expected_version: 0,
        value: { task: { create: { memo: "동시 기록 기본값", tag_ids: [] } } },
      }),
      updateBusinessSettings(settings, own.actor, {
        id: "entity_identity",
        expected_version: 0,
        value: { generation: "manual", default_source: "app", sources: [{ code: "app", label: "동시 식별 설정" }] },
      }),
    ]);
    const saved = await getBusinessSettings(settings, own.actor);
    assertEquals(saved.versions, { record_templates: 1, entity_identity: 1 });
    assertEquals(saved.settings.record_templates?.task?.create?.memo, "동시 기록 기본값");
    assertEquals(saved.settings.entity_identity?.generation, "manual");
    await updateBusinessSettings(settings, own.actor, { id: "record_templates", expected_version: 1, value: {} });
    const identity = await updateBusinessSettings(settings, own.actor, {
      id: "entity_identity",
      expected_version: 1,
      value: saved.settings.entity_identity!,
    });
    assertEquals(identity.versions, { record_templates: 2, entity_identity: 2 });
    await assertRejects(
      () =>
        updateBusinessSettings(settings, own.actor, {
          id: "entity_identity",
          expected_version: 1,
          value: saved.settings.entity_identity!,
        }),
      AppError,
      "같은 설정",
    );
    const outcomes = await Promise.allSettled(
      ["첫 번째", "두 번째"].map((memo) =>
        updateBusinessSettings(settings, first.actor, {
          id: "record_templates",
          expected_version: 0,
          value: { task: { create: { memo, tag_ids: [] } } },
        })
      ),
    );
    assertEquals(outcomes.filter((result) => result.status === "fulfilled").length, 1);
    assertEquals((await getBusinessSettings(settings, first.actor)).versions, {
      record_templates: 1,
      entity_identity: 0,
    });
  } finally {
    await own.cleanup();
    await first.cleanup();
    await sql.end();
    await admin.end();
  }
});

dbTest("업무 설정 DB: 소유자 격리·섹션 병합·경합·고정 메모·명시 빈 태그·삭제 태그·과거 기록 보존", async () => {
  const admin = connect(urls.admin), sql = connect(urls.direct);
  const own = await fixtureOwner(admin), other = await fixtureOwner(admin);
  const settings = {
    uow: new SqlBusinessSettingsUnitOfWork(sql),
    clock: { now: () => new Date("2026-10-09T00:00:00Z") },
  };
  const activity = { uow: new SqlUnitOfWork(sql), clock: { now: () => new Date() } };
  const tags = { uow: new SqlTagUnitOfWork(sql) };
  const actor = own.actor;
  try {
    const tag = await createTag(tags, actor, { id: crypto.randomUUID(), name: "기본 기록", scope: "record" });
    await updateBusinessSettings(settings, actor, {
      expected_version: 0,
      id: "record_templates",
      value: { task: { create: { memo: "${대상$}: ${할일.이후.본문$} (${액션$})", tag_ids: [tag.id] } } },
    });
    assertEquals((await getBusinessSettings(settings, other.actor)).versions, {
      record_templates: 0,
      entity_identity: 0,
    });
    assertEquals((await getBusinessSettings(settings, other.actor)).settings.record_templates, {});
    await updateBusinessSettings(settings, actor, {
      expected_version: 0,
      id: "entity_identity",
      value: { generation: "uuid", default_source: "app", sources: [{ code: "app", label: "앱 표시" }] },
    });
    assertEquals((await getBusinessSettings(settings, actor)).settings.record_templates?.task?.create?.tag_ids, [
      tag.id,
    ]);
    const input = { id: crypto.randomUUID(), kind: "once" as const, title: "고정 준비", body: "본문" };
    const prepared = await prepareBusinessRecord(settings, actor, { model: "task", action: "create", input });
    assertEquals(prepared.change_note, "고정 준비: 본문 (등록)");
    await updateBusinessSettings(settings, actor, {
      expected_version: 1,
      id: "record_templates",
      value: { task: { create: { memo: "새 기본값", tag_ids: [tag.id] } } },
    });
    await assertRejects(
      () => updateBusinessSettings(settings, actor, { expected_version: 1, id: "record_templates", value: {} }),
      AppError,
    );
    const first = await createTask(
      activity,
      actor,
      taskCreate.parse({ ...input, change_note: prepared.change_note, change_tag_ids: prepared.change_tag_ids }),
    );
    const blank = await createTask(
      activity,
      actor,
      taskCreate.parse({
        id: crypto.randomUUID(),
        kind: "once",
        title: "빈 명시",
        change_note: "",
        change_tag_ids: [],
      }),
    );
    let records =
      (await listRecords(activity, actor, recordListQuery.parse({ record_kind: "change", limit: 100 }))).items;
    const frozen = records.find((record) => record.change?.target_id === first.id)!;
    assertEquals(frozen.body, "고정 준비: 본문 (등록)");
    assertEquals(frozen.tag_ids, [tag.id]);
    const blankRecord = records.find((record) => record.change?.target_id === blank.id)!;
    assertEquals(blankRecord.body, "빈 명시 등록");
    assertEquals(blankRecord.tag_ids, []);
    await deleteTag(tags, actor, tag.id, tag.version, "태그 삭제", []);
    const next = await prepareBusinessRecord(settings, actor, {
      model: "task",
      action: "create",
      input: { kind: "once", title: "삭제 태그" },
    });
    assertEquals(next.change_tag_ids, []);
    assertEquals(next.missing_tag_ids, [tag.id]);
    const latestRecord = await getRecord(activity, actor, frozen.id);
    await updateRecord(activity, actor, frozen.id, { expected_version: latestRecord.version, body: "기록 정정" });
    records = (await listRecords(activity, actor, recordListQuery.parse({ record_kind: "change", limit: 100 }))).items;
    assertEquals(records.filter((record) => record.change?.target_id === first.id).length, 1);
    assertEquals(records.find((record) => record.id === frozen.id)?.body, "기록 정정");
  } finally {
    await own.cleanup();
    await other.cleanup();
    await sql.end();
    await admin.end();
  }
});

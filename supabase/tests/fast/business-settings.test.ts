import { assertEquals, assertRejects } from "@std/assert";
import {
  type BusinessSettingsDeps,
  getBusinessSettings,
  updateBusinessSettings,
} from "../../functions/_shared/core/settings/application.ts";
import { AppError } from "../../functions/_shared/core/shared/errors.ts";
import { prepareBusinessRecord } from "../../functions/_shared/core/settings/application.ts";
import type { BusinessSettingsResult } from "../../functions/_shared/contracts/business-settings.ts";

Deno.test("업무 설정: 모델 템플릿 저장 후 읽기, 다른 섹션 유지, 오래된 버전 거부", async () => {
  let value: BusinessSettingsResult = { version: 0, settings: {} };
  const d: BusinessSettingsDeps = {
    uow: {
      run: (_actor, fn) =>
        fn({
          get: () => Promise.resolve(value),
          update: (expected, sections) => {
            if (value.version !== expected) throw new AppError("conflict", "다른 설정이 저장되었습니다");
            value = { version: value.version + 1, settings: { ...value.settings, ...sections } };
            return Promise.resolve(value);
          },
          recordTags: (ids) => Promise.resolve(ids),
        }),
    },
  };
  const actor = { userId: crypto.randomUUID() };
  await updateBusinessSettings(d, actor, {
    expected_version: 0,
    sections: {
      record_templates: { entity: { create: { memo: "${엔터티.이후.속성2$} 등록", tag_ids: [] } } },
    },
  });
  assertEquals(
    (await getBusinessSettings(d, actor)).settings.record_templates?.entity?.create?.memo,
    "${엔터티.이후.속성2$} 등록",
  );
  await assertRejects(
    async () => await updateBusinessSettings(d, actor, { expected_version: 0, sections: { record_templates: {} } }),
    AppError,
  );
  await assertRejects(async () =>
    await updateBusinessSettings(d, actor, {
      expected_version: 1,
      sections: {
        record_templates: { entity: { create: { memo: "${엔터티.이전.속성2$}", tag_ids: [] } } },
      },
    }), AppError);
  assertEquals((await getBusinessSettings(d, actor)).version, 1);
});

Deno.test("기록 준비: 생성 할 일의 실제 기본 상태·빈 본문·미지정 기한을 해석", async () => {
  const d: BusinessSettingsDeps = {
    uow: {
      run: (_a, fn) =>
        fn({
          get: () =>
            Promise.resolve({
              version: 1,
              settings: {
                record_templates: {
                  task: { create: { memo: "${할일.이후.상태$}/${할일.이후.본문$}/${할일.이후.기한$}", tag_ids: [] } },
                },
              },
            }),
          update: () => Promise.reject(new Error("읽기 전용")),
          recordTags: () => Promise.resolve([]),
        }),
    },
  };
  const result = await prepareBusinessRecord(d, { userId: crypto.randomUUID() }, {
    model: "task",
    action: "create",
    input: { kind: "once", title: "오늘 할 일" },
  });
  assertEquals(result.change_note, "open/없음/미지정");
});

Deno.test("업무 설정: 발급처 표시 이름은 바꾸지만 저장된 코드를 제거하거나 바꾸지 않는다", async () => {
  const value: BusinessSettingsResult = {
    version: 1,
    settings: {
      entity_identity: {
        generation: "manual",
        default_source: "crm",
        sources: [{ code: "app", label: "앱" }, { code: "crm", label: "고객 관리" }],
      },
    },
  };
  const d: BusinessSettingsDeps = {
    uow: {
      run: (_actor, fn) =>
        fn({
          get: () => Promise.resolve(value),
          recordTags: () => Promise.resolve([]),
          update: (_expected, sections) => Promise.resolve({ version: 2, settings: sections }),
        }),
    },
  };
  const actor = { userId: crypto.randomUUID() };
  await assertRejects(
    () =>
      updateBusinessSettings(d, actor, {
        expected_version: 1,
        sections: {
          entity_identity: { generation: "uuid", default_source: "app", sources: [{ code: "app", label: "앱" }] },
        },
      }),
    AppError,
  );
  const renamed = await updateBusinessSettings(d, actor, {
    expected_version: 1,
    sections: {
      entity_identity: {
        generation: "manual",
        default_source: "crm",
        sources: [{ code: "app", label: "앱" }, { code: "crm", label: "고객" }],
      },
    },
  });
  assertEquals(renamed.settings.entity_identity?.sources[1], { code: "crm", label: "고객" });
});

Deno.test("기록 준비: 실제 수정 계약에서 거부할 입력을 미리보기에서도 거부", async () => {
  const d: BusinessSettingsDeps = {
    uow: {
      run: (_actor, fn) =>
        fn({
          get: () => Promise.resolve({ version: 0, settings: {} }),
          update: () => Promise.reject(new Error("읽기만")),
          recordTags: () => Promise.resolve([]),
          target: () =>
            Promise.resolve({
              version: 1,
              facts: { title: "기존", body: "유지", kind: "once", status: "open", due_on: null },
            }),
        }),
    },
  };
  await assertRejects(
    () =>
      prepareBusinessRecord(d, { userId: crypto.randomUUID() }, {
        model: "task",
        action: "update",
        target_id: crypto.randomUUID(),
        expected_version: 1,
        input: { due_on: "2026-02-30" },
      }),
    AppError,
  );
});

Deno.test("기록 준비: 해석 후 메모가 본문 제한을 넘으면 쓰기 전에 안내", async () => {
  const d: BusinessSettingsDeps = {
    uow: {
      run: (_actor, fn) =>
        fn({
          get: () =>
            Promise.resolve({
              version: 1,
              settings: { record_templates: { task: { create: { memo: "추가 ${할일.이후.본문$}", tag_ids: [] } } } },
            }),
          update: () => Promise.reject(new Error("읽기만")),
          recordTags: () => Promise.resolve([]),
        }),
    },
  };
  await assertRejects(
    () =>
      prepareBusinessRecord(d, { userId: crypto.randomUUID() }, {
        model: "task",
        action: "create",
        input: { kind: "once", title: "긴 결과", body: "가".repeat(22000) },
      }),
    AppError,
  );
});

Deno.test("복원 기록 준비: 보관한 0·태그·식별 정보를 보존하고 생략한 등록 입력을 고정", async () => {
  const d: BusinessSettingsDeps = {
    uow: {
      run: (_actor, fn) =>
        fn({
          get: () =>
            Promise.resolve({
              version: 1,
              settings: {
                record_templates: {
                  entity: {
                    restore: {
                      memo: "${엔터티.이전.속성2$} → ${엔터티.이후.속성2$} / ${엔터티.이후.식별자$}",
                      tag_ids: [],
                    },
                  },
                },
              },
            }),
          update: () => Promise.reject(new Error("읽기만")),
          recordTags: () => Promise.resolve([]),
          target: () =>
            Promise.resolve({
              version: 3,
              deleted_at: "2026-10-09T00:00:00Z",
              facts: {
                source: "app",
                external_id: "001",
                prop1: "보관값",
                prop2: 0,
                prop3: null,
                prop4: "a",
                tag_ids: [],
              },
            }),
        }),
    },
  };
  const prepared = await prepareBusinessRecord(d, { userId: crypto.randomUUID() }, {
    model: "entity",
    action: "restore",
    target_id: "app:001",
    expected_version: 3,
    input: {},
  });
  assertEquals(prepared.change_note, "0 → 0 / 001");
  assertEquals(prepared.prepared_input, { source: "app", external_id: "001", expected_version: 3 });
});

Deno.test("기록 준비: 반복 중단·재개의 기간은 실제 상태 전환과 같고 일회성 중단은 거부", async () => {
  let facts = {
    kind: "recurring",
    status: "active",
    title: "매일",
    timezone: "Asia/Seoul",
    recurrence: { freq: "daily", starts_on: "2026-01-01" },
    pauses: [],
  } as import("../../functions/_shared/core/shared/changes.ts").ChangeFacts;
  const d: BusinessSettingsDeps = {
    clock: { now: () => new Date("2026-10-09T00:00:00Z") },
    uow: {
      run: (_actor, fn) =>
        fn({
          get: () =>
            Promise.resolve({
              version: 1,
              settings: {
                record_templates: {
                  task: {
                    stop: { memo: "${할일.이후.중단기간$}", tag_ids: [] },
                    resume: { memo: "${할일.이후.중단기간$}", tag_ids: [] },
                  },
                },
              },
            }),
          update: () => Promise.reject(new Error("읽기만")),
          recordTags: () => Promise.resolve([]),
          target: () => Promise.resolve({ version: 1, facts }),
        }),
    },
  };
  const actor = { userId: crypto.randomUUID() },
    input = { model: "task", target_id: crypto.randomUUID(), expected_version: 1, input: {} };
  const stopped = await prepareBusinessRecord(d, actor, { ...input, action: "stop" });
  assertEquals(stopped.change_note, JSON.stringify([{ stopped_on: "2026-10-09", resumed_on: null }]));
  facts = { ...facts, status: "stopped", pauses: [{ stopped_on: "2026-10-08", resumed_on: null }] };
  const resumed = await prepareBusinessRecord(d, actor, { ...input, action: "resume" });
  assertEquals(resumed.change_note, JSON.stringify([{ stopped_on: "2026-10-08", resumed_on: "2026-10-09" }]));
  facts = { ...facts, kind: "once", status: "open", recurrence: null, timezone: null, pauses: [] };
  await assertRejects(() => prepareBusinessRecord(d, actor, { ...input, action: "stop" }), AppError, "반복 할 일에만");
});

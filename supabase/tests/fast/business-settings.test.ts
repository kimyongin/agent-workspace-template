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
  const d: BusinessSettingsDeps = { uow: { run: (_a, fn) => fn({
    get: () => Promise.resolve({version:1,settings:{record_templates:{task:{create:{memo:"${할일.이후.상태$}/${할일.이후.본문$}/${할일.이후.기한$}",tag_ids:[]}}}}}),
    update: () => Promise.reject(new Error("읽기 전용")), recordTags: () => Promise.resolve([]),
  }) } };
  const result = await prepareBusinessRecord(d, {userId:crypto.randomUUID()}, {model:"task",action:"create",input:{kind:"once",title:"오늘 할 일"}});
  assertEquals(result.change_note, "open/없음/미지정");
});

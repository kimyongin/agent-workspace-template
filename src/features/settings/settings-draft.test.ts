import { expect, test, vi } from "vitest";
import { createSettingsDraft } from "./settings-draft.ts";
import {
  createIdentitySettingsDraft,
  createRecordTemplatesDraft,
  orderedSources,
  unavailableTemplateTags,
} from "./business-settings-drafts.ts";
const request = vi.fn(async () => {
  throw new Error("Unexpected HTTP request in draft policy test");
});
const identitySettingsDraft = createIdentitySettingsDraft(request);
const recordTemplatesDraft = createRecordTemplatesDraft(request);

function held<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
type Saved = { version: number; value: { memo: string } };
test("업무 설정 최신값 확인은 로컬 입력을 보존하고 저장에 최신 기준 버전을 쓴다", async () => {
  const latest = held<Saved>();
  const save = vi.fn(async (value: { memo: string }, before: Saved) => ({ value, version: before.version + 1 }));
  const settings = createSettingsDraft({
    initial: { memo: "" },
    read: vi.fn().mockResolvedValueOnce({ version: 1, value: { memo: "기준" } }).mockReturnValueOnce(latest.promise),
    save,
    toDraft: (saved: Saved) => saved.value,
    refreshDraft: (_before, local) => local,
    isConflict: () => false,
  });
  await settings.read();
  settings.edit(() => ({ memo: "내 입력" }));
  const refresh = settings.read();
  expect(settings.snapshot().busy).toBe(true);
  await settings.save();
  expect(save).not.toHaveBeenCalled();
  latest.resolve({ version: 2, value: { memo: "다른 입력" } });
  await refresh;
  expect(settings.snapshot().draft).toEqual({ memo: "내 입력" });
  await settings.save();
  expect(save.mock.calls[0][1].version).toBe(2);
  expect(settings.snapshot().dirty).toBe(false);
});

test("업무 설정 읽기의 역순·취소 응답은 현재 기준값과 초안을 덮어쓰지 않는다", async () => {
  const old = held<Saved>(), latest = held<Saved>(), signals: AbortSignal[] = [];
  const settings = createSettingsDraft({
    initial: { memo: "" },
    read: (signal: AbortSignal) => {
      signals.push(signal);
      return signals.length === 1 ? old.promise : latest.promise;
    },
    save: async (value, before: Saved) => ({ value, version: before.version + 1 }),
    toDraft: (saved: Saved) => saved.value,
    refreshDraft: (_before, local) => local,
    isConflict: () => false,
  });
  const first = settings.read(), second = settings.read();
  expect(signals[0].aborted).toBe(true);
  latest.resolve({ version: 2, value: { memo: "최신" } });
  await second;
  old.resolve({ version: 1, value: { memo: "오래된 값" } });
  await first;
  expect(settings.snapshot().draft.memo).toBe("최신");
  const pending = settings.read();
  settings.cancel();
  await pending;
  expect(signals[2].aborted).toBe(true);
  expect(settings.snapshot().saved?.version).toBe(2);
});

test("업무 설정 충돌은 입력·기준 버전을 유지하며 취소는 마지막 기준값으로 돌아간다", async () => {
  const conflict = new Error("conflict");
  const settings = createSettingsDraft({
    initial: { memo: "" },
    read: async () => ({ version: 1, value: { memo: "기준" } }),
    save: async () => {
      throw conflict;
    },
    toDraft: (saved: Saved) => saved.value,
    refreshDraft: (_before, local) => local,
    isConflict: (error) => error === conflict,
  });
  await settings.read();
  settings.edit(() => ({ memo: "초안" }));
  await settings.save();
  expect(settings.snapshot()).toMatchObject({ dirty: true, busy: false, conflict: true, draft: { memo: "초안" } });
  expect(settings.snapshot().saved?.version).toBe(1);
  settings.reset();
  expect(settings.snapshot()).toMatchObject({ dirty: false, conflict: false, draft: { memo: "기준" } });
});

test("발급처 최신값 확인은 수정한 필드·순서를 보존하고 미수정 필드는 새 기준값으로 갱신", async () => {
  const before = {
    generation: "short" as const,
    default_source: "app",
    sources: [
      { code: "app", label: "앱", generation: "short" as const },
      { code: "crm", label: "고객", generation: "manual" as const },
    ],
  };
  const settings = createSettingsDraft({
    ...identitySettingsDraft,
    read: vi.fn().mockResolvedValueOnce({
      versions: { entity_identity: 1, record_templates: 9 },
      settings: { entity_identity: before },
    })
      .mockResolvedValueOnce({
        versions: { entity_identity: 2, record_templates: 10 },
        settings: {
          entity_identity: {
            ...before,
            sources: [
              { ...before.sources[0], label: "원격 앱" },
              { ...before.sources[1], label: "원격 고객" },
              { code: "new", label: "새 발급처", generation: "short" },
            ],
          },
        },
      }),
  });
  await settings.read();
  settings.edit((value) => orderedSources([{ ...value.sources[1], label: "내 고객" }, value.sources[0]], value));
  await settings.read();
  expect(settings.snapshot().draft.sources.map((source) => [source.code, source.label])).toEqual([["crm", "내 고객"], [
    "app",
    "원격 앱",
  ], ["new", "새 발급처"]]);
  expect(settings.snapshot().draft.default_source).toBe("crm");
  settings.reset();
  expect(settings.snapshot().draft.default_source).toBe("app");
});

test("기록 템플릿 최신값 확인은 초안 전체를 보존하고 취소는 최신 템플릿으로 돌아간다", async () => {
  const settings = createSettingsDraft({
    ...recordTemplatesDraft,
    read: vi.fn().mockResolvedValueOnce({
      settings: { versions: { entity_identity: 9, record_templates: 1 }, settings: {} },
      availableTags: [],
    })
      .mockResolvedValueOnce({
        settings: {
          versions: { entity_identity: 10, record_templates: 2 },
          settings: { record_templates: { entity: { create: { memo: "원격 템플릿", tag_ids: [] } } } },
        },
        availableTags: [],
      }),
  });
  await settings.read();
  settings.edit((value) => ({ ...value, entity: { ...value.entity, create: { memo: "내 템플릿", tag_ids: [] } } }));
  await settings.read();
  expect(settings.snapshot().draft.entity?.create?.memo).toBe("내 템플릿");
  expect(settings.snapshot().saved?.settings.versions.record_templates).toBe(2);
  settings.reset();
  expect(settings.snapshot().draft.entity?.create?.memo).toBe("원격 템플릿");
});

test("충돌 뒤 최신값 읽기가 실패해도 다시 최신값을 확인할 수 있는 상태를 유지", async () => {
  const conflict = new Error("conflict");
  const settings = createSettingsDraft({
    initial: { memo: "" },
    read: vi.fn().mockResolvedValueOnce({ version: 1, value: { memo: "기준" } }).mockRejectedValueOnce(
      new Error("network"),
    ),
    save: async () => {
      throw conflict;
    },
    toDraft: (saved: Saved) => saved.value,
    refreshDraft: (_before, local) => local,
    isConflict: (error) => error === conflict,
  });
  await settings.read();
  settings.edit(() => ({ memo: "초안" }));
  await settings.save();
  await settings.read();
  expect(settings.snapshot()).toMatchObject({ conflict: true, busy: false, dirty: true, draft: { memo: "초안" } });
});

test("템플릿의 누락 태그 안내는 새 로컬 선택을 삭제된 태그로 오인하지 않는다", () => {
  const saved = {
    settings: {
      versions: { record_templates: 1, entity_identity: 0 },
      settings: {
        record_templates: { entity: { create: { memo: "기준", tag_ids: ["deleted"] } } },
      },
    },
    availableTags: [],
  };
  expect(unavailableTemplateTags(saved, { entity: { create: { memo: "입력", tag_ids: ["deleted", "new"] } } })).toEqual(
    ["deleted"],
  );
  expect(unavailableTemplateTags(saved, { entity: { create: { memo: "입력", tag_ids: ["new"] } } })).toEqual([]);
});

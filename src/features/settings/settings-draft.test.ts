import { expect, test, vi } from "vitest";
import { createSettingsDraft } from "./settings-draft.ts";
import {
  createRecordTemplatesDraft,
  unavailableTemplateTags,
} from "./business-settings-drafts.ts";
const request = vi.fn(async () => {
  throw new Error("Unexpected HTTP request in draft policy test");
});
const recordTemplatesDraft = createRecordTemplatesDraft(request);

test("최신값 조회 실패 후 초안을 편집해도 이전 기준값으로 충돌을 해제할 수 없다", async () => {
  const save = vi.fn().mockRejectedValue(new Error("충돌"));
  const settings = createSettingsDraft({
    initial: { memo: "" },
    read: vi.fn().mockResolvedValueOnce({ version: 1, value: { memo: "기준" } }).mockRejectedValueOnce(new Error("조회 실패")),
    save, toDraft: (saved: { version: number; value: { memo: string } }) => saved.value,
    isConflict: () => true,
  });
  await settings.read();
  settings.edit(() => ({ memo: "초안" }));
  await settings.save();
  await settings.read();
  settings.edit(() => ({ memo: "조회 실패 뒤 편집" }));
  settings.reset();
  expect(settings.snapshot()).toMatchObject({ conflict: true, draft: { memo: "조회 실패 뒤 편집" } });
  await settings.save();
  expect(save).toHaveBeenCalledTimes(1);
});

test("충돌 중 연속 최신값 조회는 초안과 기준값이 같아져도 명시적 채택 전까지 초안을 보존한다", async () => {
  const settings = createSettingsDraft({
    initial: { memo: "" },
    read: vi.fn().mockResolvedValueOnce({ version: 1, value: { memo: "기준" } })
      .mockResolvedValueOnce({ version: 2, value: { memo: "내 초안" } })
      .mockResolvedValueOnce({ version: 3, value: { memo: "새 원격 변경" } }),
    save: vi.fn().mockRejectedValue(new Error("충돌")),
    toDraft: (saved: { version: number; value: { memo: string } }) => saved.value,
    isConflict: () => true,
  });
  await settings.read();
  settings.edit(() => ({ memo: "내 초안" }));
  await settings.save();
  await settings.read();
  expect(settings.snapshot()).toMatchObject({ conflict: true, dirty: false, draft: { memo: "내 초안" } });
  await settings.read();
  expect(settings.snapshot()).toMatchObject({ conflict: true, dirty: true, draft: { memo: "내 초안" }, saved: { version: 3 } });
  settings.reset();
  expect(settings.snapshot()).toMatchObject({ conflict: false, dirty: false, draft: { memo: "새 원격 변경" } });
});

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

test("업무 설정 충돌은 입력·기준 버전을 유지하며 최신값을 읽어야 다시 편집할 수 있다", async () => {
  const conflict = new Error("conflict");
  const settings = createSettingsDraft({
    initial: { memo: "" },
    read: async () => ({ version: 1, value: { memo: "기준" } }),
    save: async () => {
      throw conflict;
    },
    toDraft: (saved: Saved) => saved.value,
    isConflict: (error) => error === conflict,
  });
  await settings.read();
  settings.edit(() => ({ memo: "초안" }));
  await settings.save();
  expect(settings.snapshot()).toMatchObject({ dirty: true, busy: false, conflict: true, draft: { memo: "초안" } });
  expect(settings.snapshot().saved?.version).toBe(1);
  settings.reset();
  expect(settings.snapshot()).toMatchObject({ dirty: true, conflict: true, draft: { memo: "초안" } });
  await settings.read();
  settings.reset();
  expect(settings.snapshot()).toMatchObject({ dirty: false, conflict: false, draft: { memo: "기준" } });
});

test("기록 템플릿 최신값 확인은 초안 전체를 보존하고 취소는 최신 템플릿으로 돌아간다", async () => {
  const settings = createSettingsDraft({
    ...recordTemplatesDraft,
    read: vi.fn().mockResolvedValueOnce({
      settings: { versions: { record_templates: 1 }, settings: {} },
      availableTags: [],
    })
      .mockResolvedValueOnce({
        settings: {
          versions: { record_templates: 2 },
          settings: { record_templates: { task: { create: { memo: "원격 템플릿", tag_ids: [] } } } },
        },
        availableTags: [],
      }),
  });
  await settings.read();
  settings.edit((value) => ({ ...value, task: { ...value.task, create: { memo: "내 템플릿", tag_ids: [] } } }));
  await settings.read();
  expect(settings.snapshot().draft.task?.create?.memo).toBe("내 템플릿");
  expect(settings.snapshot().saved?.settings.versions.record_templates).toBe(2);
  settings.reset();
  expect(settings.snapshot().draft.task?.create?.memo).toBe("원격 템플릿");
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
      versions: { record_templates: 1 },
      settings: {
        record_templates: { task: { create: { memo: "기준", tag_ids: ["deleted"] } } },
      },
    },
    availableTags: [],
  };
  expect(unavailableTemplateTags(saved, { task: { create: { memo: "입력", tag_ids: ["deleted", "new"] } } })).toEqual(
    ["deleted"],
  );
  expect(unavailableTemplateTags(saved, { task: { create: { memo: "입력", tag_ids: ["new"] } } })).toEqual([]);
});

test("업무 설정 응답 불명은 같은 키·입력·기준 버전으로 재시도한다",async()=>{
  const { ApiError }=await import("../../lib/api-error.ts");
  const calls:{value:string;version:number;key:string}[]=[];
  let lost=true;
  const settings=createSettingsDraft({initial:{memo:""},read:async()=>({version:2,value:{memo:"기준"}}),save:async(value,before:Saved,_signal,key)=>{
    calls.push({value:value.memo,version:before.version,key});
    if(lost){lost=false;throw new ApiError(503,"unavailable","응답 불명");}
    return {version:3,value};
  },toDraft:(saved:Saved)=>saved.value,isConflict:()=>false});
  await settings.read();settings.edit(()=>({memo:"저장할 내용"}));await settings.save();
  expect(settings.snapshot().uncertain).toBe(true);
  settings.edit(()=>({memo:"다른 내용"}));await settings.read();await settings.save();
  expect(calls).toHaveLength(2);expect(calls[1]).toEqual(calls[0]);expect(settings.snapshot().uncertain).toBe(false);
  expect(settings.snapshot()).toMatchObject({
    saved: { version: 3, value: { memo: "저장할 내용" } },
    draft: { memo: "저장할 내용" },
    dirty: false,
  });
});


test("기록 편집기는 부분 조회 뒤 초안·취소·저장 버전을 보존하며 전체 저장 응답을 받는다", async () => {
  const api = vi.fn()
    .mockResolvedValueOnce({ versions: { record_templates: 2 }, settings: { record_templates: {} } })
    .mockResolvedValueOnce({ items: [], next_cursor: null })
    .mockResolvedValueOnce({ versions: { record_templates: 3 }, settings: { record_templates: { task: { create: { memo: "원격", tag_ids: [] } } } } })
    .mockResolvedValueOnce({ items: [], next_cursor: null })
    .mockResolvedValueOnce({ versions: { record_templates: 4 }, settings: { record_templates: { task: { create: { memo: "저장", tag_ids: [] } } } } });
  const settings = createSettingsDraft(createRecordTemplatesDraft(api));
  await settings.read();
  settings.edit((draft) => ({ ...draft, task: { ...draft.task, create: { memo: "내 초안", tag_ids: [] } } }));
  await settings.read();
  expect(settings.snapshot().draft.task?.create?.memo).toBe("내 초안");
  settings.reset();
  expect(settings.snapshot().draft.task?.create?.memo).toBe("원격");
  settings.edit((draft) => ({ ...draft, task: { ...draft.task, create: { memo: "저장", tag_ids: [] } } }));
  await settings.save();
  expect(api.mock.calls.filter((call) => call[0] === "GET" && call[1].startsWith("/settings/"))
    .map((call) => call[1])).toEqual(["/settings/business?id=record_templates", "/settings/business?id=record_templates"]);
  const save = api.mock.calls.find((call) => call[0] === "PATCH")!;
  expect(save.slice(0, 3)).toEqual(["PATCH", "/settings/business", {
    id: "record_templates", expected_version: 3, value: { task: { create: { memo: "저장", tag_ids: [] } } },
  }]);
  expect(settings.snapshot().dirty).toBe(false);
  expect(settings.snapshot().saved?.settings.versions.record_templates).toBe(4);
});

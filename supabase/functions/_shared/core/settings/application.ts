import {
  BUSINESS_SETTINGS_MAX_BYTES,
  type BusinessSettings,
  type BusinessSettingsResult,
  businessSettingsUpdate,
} from "../../contracts/business-settings.ts";
import type { Actor } from "../shared/actor.ts";
import { invalidInput } from "../shared/errors.ts";
import { conflict, notFound } from "../shared/errors.ts";
import { type PreparedRecordMemo, prepareRecordMemo } from "../../contracts/record-preparation.ts";
import { modelActions, type TemplateModel } from "../../contracts/record-template.ts";
import { changeDefaults } from "./change-defaults.ts";
import type { ChangeFacts } from "../shared/changes.ts";
export interface BusinessSettingsStore {
  get(): Promise<BusinessSettingsResult>;
  update(expected: number, sections: BusinessSettings): Promise<BusinessSettingsResult>;
  recordTags(ids: string[]): Promise<string[]>;
  target?(model: TemplateModel, id: string): Promise<{ version: number; facts: ChangeFacts } | null>;
}
export function prepareBusinessRecord(
  d: BusinessSettingsDeps,
  actor: Actor,
  raw: unknown,
): Promise<PreparedRecordMemo> {
  const parsed = prepareRecordMemo.safeParse(raw);
  if (!parsed.success) {
    throw invalidInput(
      "준비할 입력을 확인하세요",
      parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    );
  }
  const input = parsed.data;
  if (!modelActions(input.model).includes(input.action)) throw invalidInput("이 모델에서 사용할 수 없는 액션입니다");
  if (new TextEncoder().encode(JSON.stringify(input.input)).length > BUSINESS_SETTINGS_MAX_BYTES) {
    throw invalidInput("입력 크기가 너무 큽니다");
  }
  return d.uow.run(actor, async (store) => {
    const saved = await store.get();
    let before: ChangeFacts | null = null;
    if (input.action !== "create") {
      if (!input.target_id || !input.expected_version) throw invalidInput("대상과 expected_version이 필요합니다");
      const target = await store.target?.(input.model, input.target_id);
      if (!target) throw notFound();
      if (target.version !== input.expected_version) throw conflict("다른 변경이 저장되어 있습니다. 다시 조회하세요.");
      before = target.facts;
    }
    const after = input.action === "delete" ? null : {
      ...before,
      ...input.input,
      ...(input.action === "stop" ? { status: "stopped" } : input.action === "resume" ? { status: "active" } : {}),
    } as ChangeFacts;
    const title = String((after ?? before)?.[input.model === "entity" ? "prop1" : "title"] ?? "");
    const ids = saved.settings.record_templates?.[input.model]?.[input.action]?.tag_ids ?? [];
    const result = changeDefaults(
      {
        target_kind: input.model,
        action: input.action,
        target: { id: input.target_id ?? "", title, entity_ids: [], entity_context: [] },
        before,
        after,
        change_note: input.change_note,
        change_tag_ids: input.change_tag_ids,
      },
      saved.settings,
      await store.recordTags(ids),
    );
    return { ...result, settings_version: saved.version };
  });
}
export interface BusinessSettingsDeps {
  uow: { run<T>(actor: Actor, fn: (store: BusinessSettingsStore) => Promise<T>): Promise<T> };
}
export function getBusinessSettings(d: BusinessSettingsDeps, actor: Actor) {
  return d.uow.run(actor, (store) => store.get());
}
export function updateBusinessSettings(d: BusinessSettingsDeps, actor: Actor, input: unknown) {
  const parsed = businessSettingsUpdate.safeParse(input);
  if (!parsed.success) {
    throw invalidInput(
      "설정을 확인하세요",
      parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    );
  }
  return d.uow.run(actor, async (store) => {
    const { expected_version, sections } = parsed.data;
    const current = await store.get();
    if (
      new TextEncoder().encode(JSON.stringify({ ...current.settings, ...sections })).length >
        BUSINESS_SETTINGS_MAX_BYTES
    ) throw invalidInput(`업무 설정은 ${BUSINESS_SETTINGS_MAX_BYTES}바이트 이하입니다`);
    const ids = [
      ...new Set(
        Object.values(sections.record_templates ?? {}).flatMap((model) =>
          Object.values(model).flatMap((template) => template?.tag_ids ?? [])
        ),
      ),
    ];
    if ((await store.recordTags(ids)).length !== ids.length) {
      throw invalidInput("기록 범위에서 존재하는 태그만 기본값으로 사용할 수 있습니다", [{
        path: "sections.record_templates",
        message: "삭제되었거나 다른 범위의 태그를 제거하세요",
      }]);
    }
    return store.update(expected_version, sections);
  });
}

import {
  BUSINESS_SETTINGS_MAX_BYTES,
  type BusinessSettings,
  type BusinessSettingsResult,
  businessSettingsUpdate,
  resolvedBusinessSettings,
} from "../../contracts/business-settings.ts";
import type { Actor } from "../shared/actor.ts";
import { invalidInput } from "../shared/errors.ts";
import { conflict, notFound } from "../shared/errors.ts";
import { type PreparedRecordMemo, prepareRecordMemo } from "../../contracts/record-preparation.ts";
import { modelActions, type TemplateModel } from "../../contracts/record-template.ts";
import { changeDefaults } from "./change-defaults.ts";
import type { ChangeFacts } from "../shared/changes.ts";
import { taskCreate, taskUpdate } from "../../contracts/task.ts";
import { resumeTask, stopTask, taskContent, updateTask } from "../activity/domain.ts";
import { entityCreate, entityRekey, entityUpdate } from "../../contracts/entity.ts";
import { principleCreate, principleUpdate } from "../../contracts/principle.ts";
import { defaultEntityIdentitySettings, entityId } from "../../contracts/entity-identity.ts";
export interface BusinessSettingsStore {
  get(): Promise<BusinessSettingsResult>;
  update(expected: number, sections: BusinessSettings): Promise<BusinessSettingsResult>;
  recordTags(ids: string[]): Promise<string[]>;
  target?(
    model: TemplateModel,
    id: string,
  ): Promise<{ version: number; facts: ChangeFacts; deleted_at?: unknown } | null>;
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
  if (input.operation && (input.model !== "entity" || input.action !== "update")) {
    throw invalidInput("식별 정보 변경은 엔터티 수정에만 사용할 수 있습니다");
  }
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
      if (input.model === "entity" && !!target.deleted_at !== (input.action === "restore")) {
        throw conflict(
          input.action === "restore" ? "삭제된 대상만 복원할 수 있습니다" : "삭제된 대상입니다. 복원을 먼저 확인하세요",
        );
      }
      before = target.facts;
    }
    let content = input.input;
    let prepared_input = content;
    if (input.action === "update" || input.action === "restore") {
      const schema = input.operation === "identity"
        ? entityRekey
        : input.action === "restore"
        ? entityCreate
        : input.model === "task"
        ? taskUpdate
        : input.model === "entity"
        ? entityUpdate
        : principleUpdate;
      const mutation = schema.safeParse({ ...content, expected_version: input.expected_version });
      if (!mutation.success) {
        throw invalidInput(
          "업무 입력을 확인하세요",
          mutation.error.issues.map((issue) => ({ path: `input.${issue.path.join(".")}`, message: issue.message })),
        );
      }
      const { expected_version: _version, ...fields } = mutation.data;
      content = input.model === "task"
        ? updateTask(
          { kind: before?.kind ?? "once", version: input.expected_version! },
          taskUpdate.parse({ ...fields, expected_version: input.expected_version }),
        )
        : fields;
      prepared_input = content;
      if (input.operation === "identity") {
        const settings = saved.settings.entity_identity ?? defaultEntityIdentitySettings;
        if (!settings.sources.some((source) => source.code === content.source)) {
          throw invalidInput("등록된 발급처를 선택하세요");
        }
        const nextId = entityId(String(content.source), String(content.external_id));
        if (nextId !== input.target_id && await store.target?.("entity", nextId)) {
          throw conflict("같은 발급처·식별자의 엔터티가 있습니다");
        }
      }
      if (
        input.action === "restore" &&
        ((content.source !== undefined && content.source !== before?.source) ||
          (content.external_id !== undefined && content.external_id !== before?.external_id))
      ) throw invalidInput("복원은 같은 발급처·식별자로 준비하세요");
    }
    if (input.action === "create") {
      const schema = input.model === "task" ? taskCreate : input.model === "entity" ? entityCreate : principleCreate;
      const creationInput = input.model === "entity" ? content : { id: content.id ?? crypto.randomUUID(), ...content };
      const creation = schema.safeParse(creationInput);
      if (!creation.success) {
        throw invalidInput(
          "업무 입력을 확인하세요",
          creation.error.issues.map((issue) => ({ path: `input.${issue.path.join(".")}`, message: issue.message })),
        );
      }
      prepared_input = creation.data;
      content = input.model === "task" ? taskContent(taskCreate.parse(creationInput)) : creation.data;
      if (input.model === "entity") {
        const settings = saved.settings.entity_identity ?? defaultEntityIdentitySettings;
        const source = String(content.source ?? settings.default_source);
        if (!settings.sources.some((value) => value.code === source)) throw invalidInput("등록된 발급처를 선택하세요");
        if (!content.external_id && settings.generation === "manual") throw invalidInput("식별자를 입력하세요");
        const external_id = String(content.external_id ?? crypto.randomUUID());
        const existing = await store.target?.("entity", entityId(source, external_id));
        if (existing) {
          throw conflict(
            existing.deleted_at
              ? "삭제된 기존 대상을 조회한 뒤 restore 액션과 현재 버전으로 준비하세요"
              : "같은 발급처·식별자의 활성 엔터티가 있습니다",
          );
        }
        if (!content.prop1) throw invalidInput("속성 1은 필수입니다");
        content = {
          ...content,
          source,
          external_id,
          prop2: content.prop2 ?? null,
          prop3: content.prop3 ?? null,
          prop4: content.prop4 ?? "a",
          tag_ids: content.tag_ids ?? [],
        };
        prepared_input = content;
      }
    }
    if (input.action === "stop" || input.action === "resume") {
      const task = {
        kind: before?.kind ?? "once",
        status: before?.status ?? "open",
        version: input.expected_version!,
        recurrence: before?.recurrence ?? null,
        timezone: before?.timezone ?? null,
        pauses: before?.pauses ?? [],
      };
      content = (input.action === "stop" ? stopTask : resumeTask)(
        task,
        input.expected_version!,
        d.clock.now(),
      );
    }
    const after = input.action === "delete" ? null : {
      ...before,
      ...content,
    } as ChangeFacts;
    if (input.action === "restore") {
      prepared_input = { ...prepared_input, source: before?.source, external_id: before?.external_id };
    }
    if (input.action !== "create") prepared_input = { ...prepared_input, expected_version: input.expected_version };
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
    return { ...result, prepared_input, settings_version: saved.version };
  });
}
export interface BusinessSettingsDeps {
  clock: { now(): Date };
  uow: { run<T>(actor: Actor, fn: (store: BusinessSettingsStore) => Promise<T>): Promise<T> };
}
export function getBusinessSettings(d: BusinessSettingsDeps, actor: Actor) {
  return d.uow.run(actor, async (store) => {
    const saved = await store.get();
    return { ...saved, settings: resolvedBusinessSettings(saved.settings) };
  });
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
    if (sections.entity_identity) {
      const nextCodes = new Set(sections.entity_identity.sources.map((source) => source.code));
      if (current.settings.entity_identity?.sources.some((source) => !nextCodes.has(source.code))) {
        throw invalidInput("발급처 코드는 유지해야 합니다. 표시 이름만 바꾸거나 발급처를 추가하세요.", [{
          path: "sections.entity_identity.sources",
          message: "기존 발급처 코드를 제거하거나 변경할 수 없습니다",
        }]);
      }
    }
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

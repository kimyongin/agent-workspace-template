import { tagConnectionSelection } from "../../contracts/tag-connection.ts";
import { renderEntityTitle } from "../../contracts/entity-title-template.ts";
import { resolveIdentifierProperties } from "../entity/identifier-values.ts";
import { assertImmutableType } from "../entity/application.ts";
import type { RequestStore } from "../shared/request.ts";
import { runWrite } from "../shared/request.ts";
import {
  BUSINESS_SETTINGS_MAX_BYTES,
  type BusinessSettings,
  businessSettingsRead,
  type BusinessSettingsReadResult,
  type BusinessSettingsResult,
  type BusinessSettingsUpdate,
  businessSettingsUpdate,
  resolvedBusinessSettings,
} from "../../contracts/business-settings.ts";
import type { WorkspaceEntry } from "../workspaces/application.ts";
import type { Actor } from "../shared/actor.ts";
import { invalidInput } from "../shared/errors.ts";
import { conflict, notFound } from "../shared/errors.ts";
import {
  type PreparedRecordMemo,
  type PrepareRecordMemo,
  prepareRecordMemo,
} from "../../contracts/record-preparation.ts";
import {
  effectiveRecordTemplate,
  modelActions,
  recordTemplateTagIds,
  type TemplateModel,
} from "../../contracts/record-template.ts";
import { changeDefaults } from "./change-defaults.ts";
import type { ChangeFacts } from "../shared/changes.ts";
import { taskCreate, taskUpdate, versionOnly } from "../../contracts/task.ts";
import { resumeTask, stopTask, taskContent, updateTask } from "../activity/domain.ts";
import { entityCreate, entityRestore, entityUpdate } from "../../contracts/entity.ts";
import { decodeIdentifierValue } from "../../contracts/entity-identifiers.ts";
import { checkedProperties, type EntityDefinitions, requireDefinition } from "../entity/values.ts";
export interface BusinessSettingsStore extends RequestStore {
  definition?: EntityDefinitions["definition"];
  get(): Promise<BusinessSettingsResult>;
  getForTarget?(
    input: Pick<PrepareRecordMemo, "model" | "action" | "target_id"> & { entity_type_id?: string },
  ): Promise<BusinessSettingsResult>;
  update(input: BusinessSettingsUpdate): Promise<BusinessSettingsResult>;
  recordTags(ids: string[]): Promise<string[]>;
  target?(
    model: TemplateModel,
    id: string,
  ): Promise<{ version: number; facts: ChangeFacts; deleted_at?: string | null } | null>;
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
    if (!store.getForTarget) throw invalidInput("업무 기본 문구 준비 저장소가 필요합니다");
    const saved = await store.getForTarget({
      model: input.model,
      action: input.action,
      target_id: input.target_id,
      entity_type_id: typeof input.input.entity_type_id === "string" ? input.input.entity_type_id : undefined,
    });
    let before: ChangeFacts | null = null;
    if (input.action !== "create") {
      if (!input.target_id || !input.expected_version) throw invalidInput("대상과 expected_version이 필요합니다");
      const target = await store.target?.(input.model, input.target_id);
      if (!target) throw notFound();
      if (target.version !== input.expected_version) throw conflict("다른 변경이 저장되어 있습니다. 다시 조회하세요.");
      if (!!target.deleted_at !== (input.action === "restore")) {
        throw conflict(
          input.action === "restore" ? "삭제된 대상만 복원할 수 있습니다" : "삭제된 대상입니다. 복원을 먼저 확인하세요",
        );
      }
      before = target.facts;
    }
    const connectingTags = input.intent === "tag-connections";
    let pendingIdentifierGeneration = false;
    let content: Record<string, unknown> = connectingTags ? tagConnectionSelection.parse(input.input) : input.input;
    if (input.model === "entity" && input.action === "update") assertImmutableType(content);
    let prepared_input = content;
    if (!connectingTags && (input.action === "update" || input.action === "restore")) {
      const schema = input.action === "restore"
        ? input.model === "task" ? versionOnly : entityRestore
        : input.model === "task"
        ? taskUpdate
        : entityUpdate;
      const mutation = schema.safeParse({ ...content, expected_version: input.expected_version });
      if (!mutation.success) {
        throw invalidInput(
          "업무 입력을 확인하세요",
          mutation.error.issues.map((issue) => ({ path: `input.${issue.path.join(".")}`, message: issue.message })),
        );
      }
      const { expected_version: _version, ...fields } = mutation.data;
      content = input.model === "task" && input.action === "update"
        ? updateTask(
          { kind: before?.kind ?? "once", version: input.expected_version! },
          taskUpdate.parse({ ...fields, expected_version: input.expected_version }),
        )
        : fields;
      prepared_input = content;
    }
    if (input.action === "create") {
      const schema = input.model === "task" ? taskCreate : entityCreate;
      const creationInput = content;
      const creation = schema.safeParse(creationInput);
      if (!creation.success) {
        throw invalidInput(
          "업무 입력을 확인하세요",
          creation.error.issues.map((issue) => ({ path: `input.${issue.path.join(".")}`, message: issue.message })),
        );
      }
      prepared_input = creation.data;
      content = input.model === "task" ? taskContent(taskCreate.parse(creationInput)) : creation.data;
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
    if (!connectingTags && input.model === "entity" && input.action !== "delete") {
      if (!store.definition) throw invalidInput("자료 종류 정의 저장소가 필요합니다");
      const typeId = String(content.entity_type_id ?? before?.entity_type_id ?? "");
      const definition = await requireDefinition(
        { definition: store.definition.bind(store) },
        typeId,
        Number(content.schema_version),
        input.action === "create" || input.action === "restore",
      );
      const patch = (input.input.properties ?? {}) as Record<string, unknown>;
      const preview = { ...before?.properties, ...(content.properties as Record<string, unknown> ?? {}) };
      const selected = definition.schema["x-identity-property"];
      const intents = (content.generate_identifiers ?? {}) as Record<string, string>;
      if (input.action === "update") {
        for (const key of Object.keys(intents)) {
          if (patch[key] !== undefined) throw invalidInput("값과 자동 발급 요청을 함께 보낼 수 없습니다");
          delete preview[key];
        }
      }
      const resolved = await resolveIdentifierProperties(
        definition,
        preview,
        intents,
        input.action === "create",
        before?.properties ?? {},
        () => Promise.resolve("자동 발급"),
      );
      const generated = new Set(resolved.generated_keys);
      pendingIdentifierGeneration = generated.size > 0;
      const properties = checkedProperties(
        definition,
        resolved.properties,
        patch,
        input.action === "create",
        before?.properties,
      );
      content = {
        ...content,
        properties,
        identity_label: selected && typeof properties[selected] === "string"
          ? decodeIdentifierValue(String(properties[selected])).raw
          : "",
        title: renderEntityTitle(
          definition.schema,
          properties,
          selected && typeof properties[selected] === "string"
            ? decodeIdentifierValue(String(properties[selected])).raw
            : "",
        ),
        property_labels: Object.fromEntries(
          Object.entries(definition.schema.properties).map(([key, field]) => [key, field.title ?? key]),
        ),
      };
      if (input.action === "create") {
        // Effective values render the memo; server-owned defaults are not user write input.
        prepared_input = {
          ...prepared_input,
          properties: Object.fromEntries(
            Object.entries(properties).filter(([key]) =>
              !definition.schema.properties[key]?.readOnly && !generated.has(key)
            ),
          ),
        };
      }
    }
    const after = input.action === "delete" ? null : {
      ...before,
      ...content,
    } as ChangeFacts;
    if (input.action !== "create") prepared_input = { ...prepared_input, expected_version: input.expected_version };
    const title = String((after ?? before)?.title ?? "");
    const ids = effectiveRecordTemplate(
      saved.settings.record_templates,
      input.model,
      input.action,
      (after ?? before)?.entity_type_id,
    ).tag_ids;
    const result = changeDefaults(
      {
        target_kind: input.model,
        action: input.action,
        target: { id: input.target_id ?? "", title },
        before,
        after,
        change_note: input.change_note,
        change_tag_ids: input.change_tag_ids,
      },
      saved.settings,
      await store.recordTags(ids),
    );
    const pendingEntityId = pendingIdentifierGeneration ||
      (input.model === "entity" && input.action === "create" && !content.identity_label && content.title === "");
    return {
      ...result,
      prepared_input,
      settings_version: saved.versions.record_templates,
      ...(pendingEntityId ? { pending_entity_id: true as const } : {}),
    };
  });
}
export interface BusinessSettingsDeps {
  clock: { now(): Date };
  uow: { run<T>(actor: Actor, fn: (store: BusinessSettingsStore) => Promise<T>, entry?: WorkspaceEntry): Promise<T> };
}
export function getBusinessSettings(d: BusinessSettingsDeps, actor: Actor): Promise<BusinessSettingsResult>;
export function getBusinessSettings(
  d: BusinessSettingsDeps,
  actor: Actor,
  input: unknown,
): Promise<BusinessSettingsReadResult>;
export function getBusinessSettings(d: BusinessSettingsDeps, actor: Actor, input: unknown = {}) {
  const parsed = businessSettingsRead.safeParse(input);
  if (!parsed.success) {
    throw invalidInput(
      "설정을 확인하세요",
      parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    );
  }
  const { id } = parsed.data;
  return d.uow.run(actor, async (store) => {
    const saved = await store.get();
    const settings = resolvedBusinessSettings(saved.settings);
    if (id) return { settings: { [id]: settings[id] }, versions: { [id]: saved.versions[id] } };
    return { ...saved, settings };
  }, { mode: "business", requirements: [{ target_kind: "settings", target_id: "*", access: "read" }] });
}
export function updateBusinessSettings(d: BusinessSettingsDeps, actor: Actor, input: unknown) {
  const parsed = businessSettingsUpdate.safeParse(input);
  if (!parsed.success) {
    throw invalidInput(
      "설정을 확인하세요",
      parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    );
  }
  return runWrite<BusinessSettingsStore, BusinessSettingsResult>(
    {
      run: (actor, fn) =>
        d.uow.run(actor, fn, {
          mode: "business",
          requirements: [{ target_kind: "settings", target_id: "*", access: "write" }],
        }),
    },
    actor,
    "settings.update",
    parsed.data.id,
    parsed.data,
    async (store) => {
      const sections: BusinessSettings = { [parsed.data.id]: parsed.data.value };
      const current = await store.get();
      if (current.versions[parsed.data.id] !== parsed.data.expected_version) {
        throw conflict("같은 설정에 다른 변경이 저장되어 있습니다. 최신값을 확인한 뒤 다시 저장하세요.");
      }
      if (
        new TextEncoder().encode(JSON.stringify(parsed.data.value)).length >
          BUSINESS_SETTINGS_MAX_BYTES
      ) throw invalidInput(`업무 설정은 ${BUSINESS_SETTINGS_MAX_BYTES}바이트 이하입니다`);
      const ids = recordTemplateTagIds(sections.record_templates);
      if ((await store.recordTags(ids)).length !== ids.length) {
        throw invalidInput("기록 범위에서 존재하는 태그만 기본값으로 사용할 수 있습니다", [{
          path: "value",
          message: "삭제되었거나 다른 범위의 태그를 제거하세요",
        }]);
      }
      return store.update(parsed.data);
    },
  );
}

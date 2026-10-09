import {
  entityId,
  type EntityIdentitySettings,
  entitySourceGeneration,
  isActiveEntitySource,
} from "../../contracts/entity-identity.ts";
import type { EntityCreate, EntityResult, EntityUpdate } from "../../contracts/entity.ts";
import { changed, type ChangeFacts } from "../shared/changes.ts";
import { invalidInput } from "../shared/errors.ts";

export type EntityContent = Pick<
  EntityResult,
  "source" | "external_id" | "prop1" | "prop2" | "prop3" | "prop4" | "tag_ids"
>;

/** Preparation may request allocation; writes require the already frozen identity. */
export function registrationIdentity(
  settings: EntityIdentitySettings,
  input: Pick<EntityCreate, "source" | "external_id">,
  phase: "prepare" | "write",
) {
  const source = input.source ?? settings.default_source;
  if (!isActiveEntitySource(settings, source)) throw invalidInput("삭제되지 않은 발급처를 선택하세요");
  if (!input.external_id) {
    if (phase === "write") {
      throw invalidInput("등록 준비로 식별자를 발급한 뒤 external_id를 고정하여 저장하세요");
    }
    if (entitySourceGeneration(settings, source) === "manual") throw invalidInput("식별자를 입력하세요");
  }
  return { source, external_id: input.external_id };
}

/** Shared after-values: creation has defaults; restoration retains every omitted property. */
export function registrationContent(
  input: EntityCreate,
  identity: { source: string; external_id?: string },
  before: ChangeFacts | null = null,
): EntityContent {
  const { expected_version: _version, change_note: _note, change_tag_ids: _tags, ...fields } = input;
  if (!before && !fields.prop1) throw invalidInput("속성 1은 필수입니다");
  if (before) return { ...before, ...fields, ...identity } as EntityContent;
  return {
    ...fields,
    ...identity,
    prop1: fields.prop1!,
    prop2: fields.prop2 ?? null,
    prop3: fields.prop3 ?? null,
    prop4: fields.prop4 ?? "a",
    tag_ids: fields.tag_ids ?? [],
  } as EntityContent;
}

/** Partial identity updates and ordinary properties share the same change decision. */
export function entityUpdateDecision(
  settings: EntityIdentitySettings,
  current: { id: string; facts: ChangeFacts },
  input: Omit<EntityUpdate, "expected_version">,
  identityOnly = false,
) {
  const { change_note: _note, change_tag_ids: _tags, source, external_id, ...properties } = input;
  const identity = {
    source: source ?? current.facts.source!,
    external_id: external_id ?? current.facts.external_id!,
  };
  const id = entityId(identity.source, identity.external_id);
  const rekey = id !== current.id;
  if ((rekey || identityOnly) && !isActiveEntitySource(settings, identity.source)) {
    throw invalidInput("삭제되지 않은 발급처를 선택하세요");
  }
  return {
    id,
    identity,
    rekey,
    properties,
    contentChanged: changed(current.facts, properties),
    after: { ...current.facts, ...properties, ...identity },
  };
}

/** Restoration never changes the tuple and requires its issuer to remain active. */
export function restorationContent(settings: EntityIdentitySettings, before: ChangeFacts, input: EntityCreate) {
  if (
    (input.source !== undefined && input.source !== before.source) ||
    (input.external_id !== undefined && input.external_id !== before.external_id)
  ) throw invalidInput("복원은 같은 발급처·식별자로 준비하세요");
  if (!isActiveEntitySource(settings, before.source)) throw invalidInput("삭제된 발급처를 먼저 복원하세요");
  return registrationContent(input, { source: before.source!, external_id: before.external_id! }, before);
}

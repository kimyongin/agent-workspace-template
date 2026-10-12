import {
  entityId,
  type EntityIdentitySettings,
  entitySourceGeneration,
  isActiveEntitySource,
} from "../../contracts/entity-identity.ts";
import type { EntityCreate, EntityUpdate, EntityValues } from "../../contracts/entity.ts";
import { changed, type ChangeFacts } from "../shared/changes.ts";
import { AppError, invalidInput } from "../shared/errors.ts";

export type EntityContent = Pick<
  EntityValues,
  "source" | "external_id" | "entity_type_id" | "schema_version" | "properties" | "tag_ids"
>;

/** Both snapshots and locked write reads classify the same registration target. */
export function registrationState(existing: { deleted_at?: string | null } | null) {
  return existing ? existing.deleted_at ? "restore" : "duplicate" : "create";
}

/** Validate an issuer and optional explicit identity; automatic allocation belongs to the write transaction. */
export function registrationIdentity(
  settings: EntityIdentitySettings,
  input: Pick<EntityCreate, "source"> & { external_id: string },
): Pick<EntityContent, "source" | "external_id">;
export function registrationIdentity(
  settings: EntityIdentitySettings,
  input: Pick<EntityCreate, "source" | "external_id">,
): { source: string; external_id?: string };
export function registrationIdentity(
  settings: EntityIdentitySettings,
  input: Pick<EntityCreate, "source" | "external_id">,
) {
  const source = input.source ?? settings.default_source;
  if (!isActiveEntitySource(settings, source)) throw invalidInput("삭제되지 않은 발급처를 선택하세요");
  if (!input.external_id) {
    if (entitySourceGeneration(settings, source) === "manual") throw invalidInput("식별자를 입력하세요");
  }
  return { source, external_id: input.external_id };
}

/** Shared after-values: creation has defaults; restoration retains every omitted property. */
export function registrationContent(
  input: EntityCreate,
  identity: Pick<EntityContent, "source" | "external_id">,
  before: ChangeFacts | null = null,
): EntityContent {
  const {
    settings_version: _settings,
    expected_version: _version,
    change_note: _note,
    change_tag_ids: _tags,
    ...fields
  } = input;
  if (before?.entity_type_id && before.entity_type_id !== input.entity_type_id) {
    throw new AppError("entity_type_immutable", "자료 종류는 변경할 수 없습니다", [{
      path: "entity_type_id",
      message: "원래 자료 종류로 복원하세요",
    }]);
  }
  return {
    ...identity,
    entity_type_id: input.entity_type_id,
    schema_version: input.schema_version,
    properties: { ...before?.properties, ...input.properties },
    tag_ids: fields.tag_ids ?? before?.tag_ids ?? [],
  };
}

/** Partial identity updates and ordinary properties share the same change decision. */
export function entityUpdateDecision(
  settings: EntityIdentitySettings,
  current: { id: string; facts: ChangeFacts },
  input: Omit<EntityUpdate, "expected_version">,
  identityOnly = false,
) {
  const { change_note: _note, change_tag_ids: _tags, source, external_id, properties: patch, schema_version, ...rest } =
    input;
  const properties = {
    ...rest,
    ...(schema_version === undefined ? {} : { schema_version }),
    ...(patch === undefined ? {} : { properties: { ...current.facts.properties, ...patch } }),
  };
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

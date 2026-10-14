import { entityNumberInput } from "../../contracts/entity-identity.ts";
import type { EntityTypeIdentity } from "../../contracts/entity-issuer.ts";
import type { EntityCreate, EntityValues } from "../../contracts/entity.ts";
import { type ChangeFacts } from "../shared/changes.ts";
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
  settings: EntityTypeIdentity,
  input: Pick<EntityCreate, "source" | "expected_version"> & { external_id: string },
): Pick<EntityContent, "source" | "external_id">;
export function registrationIdentity(
  settings: EntityTypeIdentity,
  input: Pick<EntityCreate, "source" | "external_id" | "expected_version">,
): { source: string; external_id?: string };
export function registrationIdentity(
  settings: EntityTypeIdentity,
  input: Pick<EntityCreate, "source" | "external_id" | "expected_version">,
) {
  const source = input.source ?? settings.default_source;
  if (input.external_id !== undefined && !entityNumberInput.safeParse(input.external_id).success) {
    throw invalidInput("번호는 앞뒤 공백 없이 원본 문자열로 입력하세요");
  }
  const binding = settings.sources.find((value) => value.code === source);
  if (!binding || (input.expected_version === undefined && !binding.active)) {
    throw invalidInput("등록 가능한 발급처를 선택하세요");
  }
  if (!input.external_id) {
    if (binding.generation === "direct") throw invalidInput("식별자를 입력하세요");
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
    identity_version: _settings,
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

/** Restoration retains the original immutable tuple, including retired issuer bindings. */
export function restorationContent(settings: EntityTypeIdentity, before: ChangeFacts, input: EntityCreate) {
  if (
    (input.source !== undefined && input.source !== before.source) ||
    (input.external_id !== undefined && input.external_id !== before.external_id)
  ) {
    throw invalidInput("복원은 같은 발급처·번호로 준비하세요");
  }
  registrationIdentity(settings, {
    source: before.source!,
    external_id: before.external_id!,
    expected_version: input.expected_version,
  });
  return registrationContent(input, { source: before.source!, external_id: before.external_id! }, before);
}

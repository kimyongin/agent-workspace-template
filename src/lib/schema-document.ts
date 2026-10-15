import { entityFieldChoices, entitySchemaPresentation } from "@contracts/entity-type.ts";
import type { EntityField, EntitySchemaVersion } from "@contracts/entity-type.ts";

/** Presentation is always derived from the document, never an independent draft. */
export function schemaPresentation(definition: Pick<EntitySchemaVersion, "schema">) {
  return entitySchemaPresentation(definition.schema);
}
export function fieldChoices(field: EntityField | undefined) {
  return field ? entityFieldChoices(field) : undefined;
}
export function fieldChoiceLabels(field: EntityField | undefined): Record<string, string> {
  return Object.fromEntries(
    (field?.oneOf ?? []).filter((option) => option.const !== null && option.title !== undefined)
      .map((option) => [option.const!, option.title!]),
  );
}

/** Resolve the typed const directly: JSON null and the string "null" are different choices. */
export function fieldChoiceTitle(field: EntityField | undefined, value: unknown): string | undefined {
  return field?.oneOf?.find((option) => option.const === value)?.title;
}

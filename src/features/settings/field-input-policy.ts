import type { EntityField } from "@contracts/entity-type.ts";
import { fieldType } from "../entity/property-fields.tsx";

/** Required is the only user-facing empty-value choice for new or explicitly changed fields. */
export function fieldInputPolicy(
  field: EntityField,
  required: boolean,
): EntityField {
  const scalar = fieldType(field) ?? "string";
  const next: EntityField = {
    ...field,
    type: required ? scalar : [scalar, "null"],
  };
  if (field.enum) {
    next.enum = [
      ...field.enum.filter((value) => value !== null),
      ...(required ? [] : [null]),
    ];
  }
  if (required && scalar === "string" && !field.format && !field.enum) {
    next.minLength = Math.max(1, field.minLength ?? 0);
  }
  if (required && next.default === null) delete next.default;
  return next;
}

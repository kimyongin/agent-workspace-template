import { entityNumberDraft } from "@contracts/entity-number.ts";
import type { MigrationPlan, SchemaDefinition } from "@contracts/entity-schema-change.ts";
import { fieldType } from "../entity/property-fields.tsx";
export function schemaNumericValues(definition: SchemaDefinition, drafts: Record<string, string>): SchemaDefinition {
  const next = structuredClone(definition);
  for (const [address, raw] of Object.entries(drafts)) {
    const [key, name] = address.split(":");
    const field = next.schema.properties[key];
    if (!field || name === "default" && (!Object.hasOwn(field, "default") || field.default === null)) continue;
    const kind = fieldType(field);
    if ((name === "minimum" || name === "maximum" || name === "default") && !["integer", "number"].includes(kind ?? "")) continue;
    if ((name === "minLength" || name === "maxLength") && kind !== "string") continue;
    Object.assign(field, { [name]: raw === "" && name !== "default" ? undefined : entityNumberDraft(raw, name === "minLength" || name === "maxLength" ? "integer" : kind as "integer" | "number") });
  }
  return next;
}
export function migrationNumericValues(definition: SchemaDefinition, migration: MigrationPlan): MigrationPlan {
  const value = (key: string, input: MigrationPlan["overrides"][number]["value"]) => {
    const kind = fieldType(definition.schema.properties[key]);
    return typeof input === "string" && (kind === "integer" || kind === "number") ? entityNumberDraft(input, kind) : input;
  };
  return {
    rules: migration.rules.map((rule) => rule.op === "fill" || rule.op === "replace_failure" ? { ...rule, value: value(rule.key, rule.value) } : rule),
    overrides: migration.overrides.map((row) => ({ ...row, value: value(row.key, row.value) })),
  };
}

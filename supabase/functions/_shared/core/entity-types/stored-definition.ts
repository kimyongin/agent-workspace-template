import type { EntityField, EntitySchema, EntitySchemaVersion } from "../../contracts/entity-type.ts";
/** Decode retained pre-transition evidence without rewriting its durable bytes or fingerprints.
 * Missing historical root metadata remains missing; recovery overlays the current root. */
export function normalizeStoredEntityDefinition(
  raw: unknown,
  typeId: string,
  version: number,
): Pick<EntitySchemaVersion, "schema"> {
  const input = structuredClone(raw) as {
    schema: EntitySchema;
    display?: {
      representative: string;
      order: string[];
      list_columns: string[];
      archived: string[];
      option_labels: Record<string, Record<string, string>>;
    };
  };
  const schema = input.schema;
  schema["x-type-id"] ??= typeId;
  schema["x-version"] ??= version;
  const display = input.display;
  if (display) {
    for (const [key, field] of Object.entries(schema.properties)) {
      field["x-order"] = (display.order.indexOf(key) + 1) * 10;
      if (!field["x-order"]) field["x-order"] = (Object.keys(schema.properties).indexOf(key) + 1) * 10;
      field["x-representative"] = display.representative === key;
      field["x-show-in-list"] = display.list_columns.includes(key);
      if (display.list_columns.includes(key)) field["x-list-order"] = (display.list_columns.indexOf(key) + 1) * 10;
      field.deprecated = display.archived.includes(key);
      const old = field as EntityField & { enum?: Array<string | null> };
      if (old.enum) {
        field.oneOf = old.enum.map((code) => ({
          const: code,
          ...(code !== null && Object.hasOwn(display.option_labels[key] ?? {}, code)
            ? { title: display.option_labels[key][code] }
            : {}),
        }));
        delete old.enum;
      }
    }
  }
  return { schema };
}

import { type EntitySchema, entitySchemaPresentation } from "../../contracts/entity-type.ts";
import type postgres from "postgres";
import type { EntityValues } from "../../contracts/entity.ts";
import type { EntityDefinition } from "../../core/entity/values.ts";
import { resolvedEntityTypeIcon } from "../../contracts/entity-type.ts";
import { AppError } from "../../core/shared/errors.ts";
/** Actor RLS and the caller's transaction supply ownership; this module starts no transaction. */
export async function loadEntityDefinition(
  tx: postgres.TransactionSql,
  typeId: string,
  lock = false,
): Promise<EntityDefinition | null> {
  if (lock) {
    const [type] = await tx`select * from app.entity_types where id::text=${typeId} for update`;
    if (!type) return null;
    if (type.schema_write_locked) {
      const [job] =
        await tx`select id,version from app.entity_schema_migrations where type_id=${typeId} and status in ('queued','preparing','ready_to_commit','committing')`;
      throw new AppError(
        "schema_migration_in_progress",
        "속성 마이그레이션 중입니다. 완료 후 다시 저장하세요",
        undefined,
        {
          type_id: typeId,
          schema_version: Number(type.schema_version),
          ...(job ? { job_id: job.id, job_version: Number(job.version) } : {}),
        },
      );
    }
  }
  const [row] =
    await tx`select v.schema,t.id,v.schema->>'title' as label,v.schema->>'x-icon' as icon_id,coalesce((v.schema->>'deprecated')::boolean,false) as archived,t.schema_version as version,t.schema_version from app.entity_types t
    join app.entity_schema_versions v on v.workspace_id=t.workspace_id and v.type_id=t.id and v.schema_version=t.schema_version where t.id::text=${typeId}`;
  return row
    ? {
      schema: row.schema,
      type_id: row.id,
      schema_version: Number(row.schema_version),
      type_version: Number(row.version),
      type: { id: row.id, label: row.label, icon_id: resolvedEntityTypeIcon(row.icon_id), archived: row.archived },
    }
    : null;
}
/** Business mutations lock only their permitted current kind; settings editing
 * retains its separate settings-authorized row lock above. */
export async function loadBusinessEntityDefinition(
  tx: postgres.TransactionSql,
  typeId: string,
  lock = false,
): Promise<EntityDefinition | null> {
  if (lock) {
    const [locked] = await tx`select app.lock_business_entity_type(${typeId}::uuid,true) as kind`;
    const kind = locked.kind;
    if (!kind) return null;
    if (kind.schema_write_locked) {
      throw new AppError(
        "schema_migration_in_progress",
        "속성 마이그레이션 중입니다. 완료 후 다시 저장하세요",
        undefined,
        {
          type_id: typeId,
          schema_version: Number(kind.schema_version),
        },
      );
    }
  }
  return loadEntityDefinition(tx, typeId);
}
/** Current display settings project unchanged stored values after compatible publication. */
/** Joined entity+current definition reads use one statement snapshot, including during atomic migration. */
export function entityPresentationRow(row: Record<string, unknown>, properties: EntityValues["properties"]) {
  const display = entitySchemaPresentation(row.schema as EntitySchema);
  return {
    type: {
      id: String(row.type_id ?? row.id),
      label: String(row.label),
      icon_id: resolvedEntityTypeIcon(String(row.icon_id)),
      archived: Boolean(row.archived),
    },
    current_schema_version: Number(row.current_schema_version ?? row.schema_version),
    title: String(properties[display.representative]),
    display_properties: Object.fromEntries(
      display.list_columns.filter((key) => Object.hasOwn(properties, key)).map((key) => [key, properties[key]]),
    ),
  };
}

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
          type_version: Number(type.version),
          schema_version: Number(type.schema_version),
          ...(job ? { job_id: job.id, job_version: Number(job.version) } : {}),
        },
      );
    }
  }
  const [row] =
    await tx`select v.schema,v.display,t.id,t.label,t.icon_id,t.archived,t.version,t.schema_version from app.entity_types t
    join app.entity_schema_versions v on v.owner_id=t.owner_id and v.type_id=t.id and v.schema_version=t.schema_version where t.id::text=${typeId}`;
  return row
    ? {
      schema: row.schema,
      display: row.display,
      type_id: row.id,
      schema_version: Number(row.schema_version),
      type_version: Number(row.version),
      type: { id: row.id, label: row.label, icon_id: resolvedEntityTypeIcon(row.icon_id), archived: row.archived },
    }
    : null;
}
/** Current display settings project unchanged stored values after compatible publication. */
export async function entityPresentation(
  tx: postgres.TransactionSql,
  typeId: string,
  _version: number,
  properties: EntityValues["properties"],
) {
  const [row] = await tx`select v.display,t.id,t.label,t.icon_id,t.archived,t.schema_version from app.entity_types t
    join app.entity_schema_versions v on v.owner_id=t.owner_id and v.type_id=t.id where t.id::text=${typeId} and v.schema_version=t.schema_version`;
  if (!row) throw new Error("Entity schema reference is missing");
  return entityPresentationRow(row, properties);
}
/** Joined entity+current definition reads use one statement snapshot, including during atomic migration. */
export function entityPresentationRow(row: Record<string, unknown>, properties: EntityValues["properties"]) {
  const display = row.display as { representative: string; list_columns: string[] };
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

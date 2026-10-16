import type postgres from "postgres";
/** Metadata is projected from the current immutable document under the type row lock. */
export async function loadSchemaType(tx: postgres.TransactionSql, id: string, lock = false) {
  const [row] =
    await tx`select t.*,v.schema,v.schema->>'title' as label,v.schema->>'x-icon' as icon_id,coalesce((v.schema->>'deprecated')::boolean,false) as archived,t.schema_version as version from app.entity_types t
    join app.entity_schema_versions v on v.owner_id=t.owner_id and v.type_id=t.id and v.schema_version=t.schema_version
    where t.id::text=${id} ${lock ? tx`for update of t` : tx``}`;
  return row;
}

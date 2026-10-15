import { SqlEntityIssuerStore } from "./entity-issuer-store.ts";
import { SqlSchemaMigrationStore } from "./schema-migration-store.ts";
import type postgres from "postgres";
import type { Actor } from "../../core/shared/actor.ts";
import type { RequestIdentity } from "../../core/shared/request.ts";
import {
  assertEntityTypeCapacity,
  assertEntityTypeLabelAvailable,
  type EntityTypeStore,
  entityTypeUpdateDecision,
} from "../../core/entity-types/application.ts";
import type { EntitySchemaVersion, EntityType } from "../../contracts/entity-type.ts";
import { resolvedEntityTypeIcon } from "../../contracts/entity-type.ts";
import { AppError, notFound } from "../../core/shared/errors.ts";
import { executeSqlRequest } from "./request-ledger.ts";
import { runAsActor } from "./sql-context.ts";
function typeRow(row: postgres.Row): EntityType {
  return {
    id: row.id,
    label: row.label,
    icon_id: resolvedEntityTypeIcon(row.icon_id),
    archived: row.archived,
    version: Number(row.version),
    schema_version: Number(row.schema_version),
    next_property_number: Number(row.next_property_number),
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}
function schemaRow(row: postgres.Row): EntitySchemaVersion {
  return {
    type_id: row.type_id,
    schema_version: Number(row.schema_version),
    schema: row.schema,
    display: row.display,
    created_at: row.created_at.toISOString(),
  };
}
export class SqlEntityTypeStore extends SqlSchemaMigrationStore implements EntityTypeStore {
  private async hydrate(row: postgres.Row): Promise<EntityType> {
    return {
      ...typeRow(row),
      identity: (await new SqlEntityIssuerStore(this.tx, this.actor).getTypeIdentity(row.id))!,
    };
  }

  executeRequest<T>(request: RequestIdentity, execute: () => Promise<T>) {
    return executeSqlRequest(this.tx, this.actor, request, execute);
  }
  async list(input: Parameters<EntityTypeStore["list"]>[0]) {
    const rows = await this.tx`select * from app.entity_types where (${input.include_archived} or not archived) and (${
      input.cursor ?? null
    }::text is null or id::text > ${input.cursor ?? null}) order by id limit ${input.limit + 1}`;
    return {
      items: await Promise.all(rows.slice(0, input.limit).map((row) => this.hydrate(row))),
      next_cursor: rows.length > input.limit ? String(rows[input.limit - 1].id) : null,
    };
  }
  async get(id: string) {
    const [row] = await this.tx`select * from app.entity_types where id::text=${id}`;
    return row ? this.hydrate(row) : null;
  }
  async create(input: Parameters<EntityTypeStore["create"]>[0], definition: Parameters<EntityTypeStore["create"]>[1]) {
    await this.tx`select pg_advisory_xact_lock(hashtextextended(${this.actor.userId + ":entity-types"},0))`;
    const [count] = await this.tx`select count(*)::int as count from app.entity_types`;
    assertEntityTypeCapacity(count.count);
    await this.assertActiveLabel(input.label);
    const [row] = await this
      .tx`insert into app.entity_types(owner_id,label,icon_id) values (${this.actor.userId},${input.label},${input.icon_id}) returning *`;
    await this
      .tx`insert into app.entity_schema_versions(owner_id,type_id,schema_version,schema,display) values (${this.actor.userId},${row.id},1,${
      this.tx.json(definition.schema as never)
    },${this.tx.json(definition.display as never)})`;
    await new SqlEntityIssuerStore(this.tx, this.actor).initializeTypeIdentity(row.id);
    return this.hydrate(row);
  }
  private async assertActiveLabel(label: string, exceptId?: string) {
    const [duplicate] = await this.tx`select 1 from app.entity_types where not archived and label=${label}
      and (${exceptId ?? null}::uuid is null or id<>${exceptId ?? null}::uuid) limit 1`;
    assertEntityTypeLabelAvailable(!!duplicate);
  }
  async update(id: string, input: Parameters<EntityTypeStore["update"]>[1]) {
    await this.tx`select pg_advisory_xact_lock(hashtextextended(${this.actor.userId + ":entity-types"},0))`;
    const [row] = await this.tx`select * from app.entity_types where id::text=${id} for update`;
    if (!row) throw notFound();
    if (row.schema_write_locked) {
      throw new AppError("schema_migration_in_progress", "속성 마이그레이션 완료 후 다시 시도하세요");
    }
    const next = entityTypeUpdateDecision({ ...typeRow(row), icon_id: row.icon_id }, input);
    if (!next) return this.hydrate(row);
    const { label, icon_id: icon, archived } = next;
    // Existing duplicate labels may be edited without forcing a destructive cleanup.
    if (!archived && (row.archived || label !== row.label)) await this.assertActiveLabel(label, row.id);
    const [saved] = await this
      .tx`update app.entity_types set label=${label},icon_id=${icon},archived=${archived},version=version+1,updated_at=now() where id=${row.id} returning *`;
    return this.hydrate(saved);
  }
  async schema(id: string, version?: number) {
    const [row] = await this
      .tx`select v.*,to_jsonb(t) as current_type from app.entity_schema_versions v join app.entity_types t on t.owner_id=v.owner_id and t.id=v.type_id where t.id::text=${id} and v.schema_version=coalesce(${
      version ?? null
    },t.schema_version)`;
    if (!row) return null;
    const current = row.current_type;
    return {
      ...schemaRow(row),
      identity: (await new SqlEntityIssuerStore(this.tx, this.actor).getTypeIdentity(current.id))!,
      type: {
        id: current.id,
        label: current.label,
        icon_id: resolvedEntityTypeIcon(current.icon_id),
        archived: current.archived,
      },
      type_version: Number(current.version),
    };
  }
  async history(input: Parameters<EntityTypeStore["history"]>[0]) {
    const rows = await this.tx`select * from app.entity_schema_versions where type_id::text=${input.type_id} and (${
      input.before ?? null
    }::int is null or schema_version < ${input.before ?? null}) order by schema_version desc limit ${input.limit + 1}`;
    return {
      items: rows.slice(0, input.limit).map((row) => ({
        type_id: row.type_id,
        schema_version: Number(row.schema_version),
        created_at: row.created_at.toISOString(),
      })),
      next_before: rows.length > input.limit ? Number(rows[input.limit - 1].schema_version) : null,
    };
  }
}
export class SqlEntityTypeUnitOfWork {
  constructor(private readonly sql: postgres.Sql) {}
  run<T>(actor: Actor, fn: (store: EntityTypeStore) => Promise<T>): Promise<T> {
    return runAsActor(this.sql, actor, (tx) => fn(new SqlEntityTypeStore(tx, actor)));
  }
}

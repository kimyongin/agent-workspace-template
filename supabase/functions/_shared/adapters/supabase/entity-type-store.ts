import { normalizeStoredEntityDefinition } from "../../core/entity-types/stored-definition.ts";
import { loadSchemaType } from "./schema-type.ts";
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
import { executeSqlRequest, replayRetainedSqlRequest } from "./request-ledger.ts";
import { runAsActor } from "./sql-context.ts";
function typeRow(row: postgres.Row): EntityType {
  return {
    id: row.id,
    label: row.label,
    icon_id: resolvedEntityTypeIcon(row.icon_id),
    archived: row.archived,
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
    schema: normalizeStoredEntityDefinition({ schema: row.schema }, row.type_id, Number(row.schema_version)).schema,
    ...(row.schema.title === undefined || row.schema["x-icon"] === undefined || row.schema.deprecated === undefined
      ? { metadata_missing: true }
      : {}),
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

  replayRetainedRequest<T>(request: RequestIdentity) {
    return replayRetainedSqlRequest<T>(this.tx, this.actor, request);
  }
  executeRequest<T>(request: RequestIdentity, execute: () => Promise<T>) {
    return executeSqlRequest(this.tx, this.actor, request, execute);
  }
  async list(input: Parameters<EntityTypeStore["list"]>[0]) {
    const rows = await this
      .tx`select t.*,v.schema->>'title' as label,v.schema->>'x-icon' as icon_id,coalesce((v.schema->>'deprecated')::boolean,false) as archived from app.entity_types t join app.entity_schema_versions v on v.owner_id=t.owner_id and v.type_id=t.id and v.schema_version=t.schema_version where (${input.include_archived} or not coalesce((v.schema->>'deprecated')::boolean,false)) and (${
      input.cursor ?? null
    }::text is null or t.id::text > ${input.cursor ?? null}) order by t.id limit ${input.limit + 1}`;
    return {
      items: await Promise.all(rows.slice(0, input.limit).map((row) => this.hydrate(row))),
      next_cursor: rows.length > input.limit ? String(rows[input.limit - 1].id) : null,
    };
  }
  async get(id: string) {
    const row = await loadSchemaType(this.tx, id);
    return row ? this.hydrate(row) : null;
  }
  async create(input: Parameters<EntityTypeStore["create"]>[0], definition: Parameters<EntityTypeStore["create"]>[1]) {
    await this.tx`select pg_advisory_xact_lock(hashtextextended(${this.actor.userId + ":entity-types"},0))`;
    const [count] = await this.tx`select count(*)::int as count from app.entity_types`;
    assertEntityTypeCapacity(count.count);
    await this.assertActiveLabel(input.label);
    const id = crypto.randomUUID();
    await this.tx`insert into app.entity_types(id,owner_id) values (${id},${this.actor.userId})`;
    const schema = {
      ...definition.schema,
      "x-type-id": id,
      "x-version": 1,
      title: input.label,
      "x-icon": input.icon_id,
      deprecated: false,
    };
    await this.tx`insert into app.entity_schema_versions(owner_id,schema) values (${this.actor.userId},${
      this.tx.json(schema as never)
    })`;
    const row = (await loadSchemaType(this.tx, id))!;
    await new SqlEntityIssuerStore(this.tx, this.actor).initializeTypeIdentity(row.id);
    return this.hydrate(row);
  }
  async createImportedType(document: EntitySchemaVersion["schema"]) {
    await this.tx`select pg_advisory_xact_lock(hashtextextended(${this.actor.userId + ":entity-types"},0))`;
    const [count] = await this.tx`select count(*)::int as count from app.entity_types`;
    assertEntityTypeCapacity(count.count);
    if (!document.deprecated) await this.assertActiveLabel(document.title!);
    const id = crypto.randomUUID(), schema = { ...document, "x-type-id": id, "x-version": 1 };
    const next = Object.keys(schema.properties).length + 1;
    await this
      .tx`insert into app.entity_types(id,owner_id,next_property_number) values (${id},${this.actor.userId},${next})`;
    await this.tx`insert into app.entity_schema_versions(owner_id,schema) values (${this.actor.userId},${
      this.tx.json(schema as never)
    })`;
    await new SqlEntityIssuerStore(this.tx, this.actor).initializeTypeIdentity(id);
    return this.hydrate((await loadSchemaType(this.tx, id))!);
  }
  private async assertActiveLabel(label: string, exceptId?: string) {
    const [duplicate] = await this
      .tx`select 1 from app.entity_types t join app.entity_schema_versions v on v.owner_id=t.owner_id and v.type_id=t.id and v.schema_version=t.schema_version where not coalesce((v.schema->>'deprecated')::boolean,false) and v.schema->>'title'=${label}
      and (${exceptId ?? null}::uuid is null or t.id<>${exceptId ?? null}::uuid) limit 1`;
    assertEntityTypeLabelAvailable(!!duplicate);
  }
  async update(id: string, input: Parameters<EntityTypeStore["update"]>[1]) {
    await this.tx`select pg_advisory_xact_lock(hashtextextended(${this.actor.userId + ":entity-types"},0))`;
    const row = await loadSchemaType(this.tx, id, true);
    if (!row) throw notFound();
    if (row.schema_write_locked) {
      throw new AppError("schema_migration_in_progress", "속성 마이그레이션 완료 후 다시 시도하세요");
    }
    const next = entityTypeUpdateDecision({ ...typeRow(row), icon_id: row.icon_id }, input);
    if (!next) return this.hydrate(row);
    const { label, icon_id: icon, archived } = next;
    // Existing duplicate labels may be edited without forcing a destructive cleanup.
    if (!archived && (row.archived || label !== row.label)) await this.assertActiveLabel(label, row.id);
    const revision = Number(row.schema_version) + 1;
    const schema = { ...row.schema, title: label, "x-icon": icon, deprecated: archived, "x-version": revision };
    await this.tx`insert into app.entity_schema_versions(owner_id,schema) values (${this.actor.userId},${
      this.tx.json(schema)
    })`;
    await this.tx`update app.entity_types set schema_version=${revision},updated_at=now() where id=${row.id}`;
    const saved = (await loadSchemaType(this.tx, id))!;
    return this.hydrate(saved);
  }
  async schema(id: string, version?: number) {
    const [row] = await this
      .tx`select v.*,to_jsonb(t) as current_type,cv.schema as current_schema from app.entity_schema_versions v join app.entity_types t on t.owner_id=v.owner_id and t.id=v.type_id join app.entity_schema_versions cv on cv.owner_id=t.owner_id and cv.type_id=t.id and cv.schema_version=t.schema_version where t.id::text=${id} and v.schema_version=coalesce(${
      version ?? null
    },t.schema_version)`;
    if (!row) return null;
    const current = row.current_type;
    return {
      ...schemaRow(row),
      identity: (await new SqlEntityIssuerStore(this.tx, this.actor).getTypeIdentity(current.id))!,
      type: {
        id: current.id,
        label: row.current_schema.title,
        icon_id: resolvedEntityTypeIcon(row.current_schema["x-icon"]),
        archived: row.current_schema.deprecated ?? false,
      },
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

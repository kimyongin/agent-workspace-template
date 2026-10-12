import type postgres from "postgres";
import type { Actor } from "../../core/shared/actor.ts";
import type { RequestIdentity } from "../../core/shared/request.ts";
import type { EntityTypeStore } from "../../core/entity-types/application.ts";
import type { EntitySchemaVersion, EntityType } from "../../contracts/entity-type.ts";
import { entitySchemaLimits, resolvedEntityTypeIcon } from "../../contracts/entity-type.ts";
import { AppError, invalidInput, notFound } from "../../core/shared/errors.ts";
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
export class SqlEntityTypeStore implements EntityTypeStore {
  constructor(private readonly tx: postgres.TransactionSql, private readonly actor: Actor) {}
  executeRequest<T>(request: RequestIdentity, execute: () => Promise<T>) {
    return executeSqlRequest(this.tx, this.actor, request, execute);
  }
  async list(input: Parameters<EntityTypeStore["list"]>[0]) {
    const rows = await this.tx`select * from app.entity_types where (${input.include_archived} or not archived) and (${
      input.cursor ?? null
    }::text is null or id::text > ${input.cursor ?? null}) order by id limit ${input.limit + 1}`;
    return {
      items: rows.slice(0, input.limit).map(typeRow),
      next_cursor: rows.length > input.limit ? String(rows[input.limit - 1].id) : null,
    };
  }
  async get(id: string) {
    const [row] = await this.tx`select * from app.entity_types where id::text=${id}`;
    return row ? typeRow(row) : null;
  }
  async create(input: Parameters<EntityTypeStore["create"]>[0], definition: Parameters<EntityTypeStore["create"]>[1]) {
    await this.tx`select pg_advisory_xact_lock(hashtextextended(${this.actor.userId + ":entity-types"},0))`;
    const [count] = await this.tx`select count(*)::int as count from app.entity_types`;
    if (count.count >= entitySchemaLimits.types) throw invalidInput("자료 종류는 64개까지 만들 수 있습니다");
    const [row] = await this
      .tx`insert into app.entity_types(owner_id,label,icon_id) values (${this.actor.userId},${input.label},${input.icon_id}) returning *`;
    await this
      .tx`insert into app.entity_schema_versions(owner_id,type_id,schema_version,schema,display) values (${this.actor.userId},${row.id},1,${
      this.tx.json(definition.schema as never)
    },${this.tx.json(definition.display as never)})`;
    return typeRow(row);
  }
  async update(id: string, input: Parameters<EntityTypeStore["update"]>[1]) {
    const [row] = await this.tx`select * from app.entity_types where id::text=${id} for update`;
    if (!row) throw notFound();
    if (
      Number(row.version) !== input.expected_type_version ||
      Number(row.schema_version) !== input.expected_schema_version
    ) {
      throw new AppError(
        "schema_changed",
        "자료 종류나 속성 정의가 변경되었습니다. 최신 버전을 확인하세요.",
        undefined,
        { type_id: id, type_version: Number(row.version), schema_version: Number(row.schema_version) },
      );
    }
    const label = input.label ?? row.label,
      icon = input.icon_id ?? row.icon_id,
      archived = input.archived ?? row.archived;
    if (label === row.label && icon === row.icon_id && archived === row.archived) return typeRow(row);
    const [saved] = await this
      .tx`update app.entity_types set label=${label},icon_id=${icon},archived=${archived},version=version+1,updated_at=now() where id=${row.id} returning *`;
    return typeRow(saved);
  }
  async schema(id: string, version?: number) {
    const [row] = await this
      .tx`select v.* from app.entity_schema_versions v join app.entity_types t on t.owner_id=v.owner_id and t.id=v.type_id where t.id::text=${id} and v.schema_version=coalesce(${
      version ?? null
    },t.schema_version)`;
    return row ? schemaRow(row) : null;
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

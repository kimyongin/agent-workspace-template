import type postgres from "postgres";
import type { Actor } from "../../core/shared/actor.ts";
import type { RequestIdentity } from "../../core/shared/request.ts";
import type { EntityRelationDefinitionStore } from "../../core/entity-relations/application.ts";
import type { EntityRelationDefinition } from "../../contracts/entity-relation.ts";
import { invalidInput } from "../../core/shared/errors.ts";
import { runAsActor } from "./sql-context.ts";
import { executeSqlRequest } from "./request-ledger.ts";
export function relationDefinitionRow(r: postgres.Row): EntityRelationDefinition {
  return {
    id: r.id,
    version: Number(r.version),
    archived: r.archived,
    ends: [{ type_id: r.left_type_id, label: r.left_label, cardinality: r.left_cardinality }, {
      type_id: r.right_type_id,
      label: r.right_label,
      cardinality: r.right_cardinality,
    }],
  };
}
export class SqlEntityRelationDefinitionStore implements EntityRelationDefinitionStore {
  constructor(protected readonly tx: postgres.TransactionSql, protected readonly actor: Actor) {}
  executeRequest<T>(r: RequestIdentity, execute: () => Promise<T>) {
    return executeSqlRequest(this.tx, this.actor, r, execute);
  }
  async lockOwner() {
    await this.tx`select pg_advisory_xact_lock(hashtextextended(${this.actor.userId + ":entity-relations"},0))`;
  }
  async list(input: Parameters<EntityRelationDefinitionStore["list"]>[0]) {
    const rows = await this.tx`select * from app.entity_relation_definitions where (${
      input.type_id ?? null
    }::uuid is null or left_type_id=${input.type_id ?? null}::uuid or right_type_id=${
      input.type_id ?? null
    }::uuid) and (${input.archived}='all' or archived=(${input.archived}='archived')) and (${
      input.q ?? ""
    }='' or strpos(lower(left_label||' '||right_label),lower(${input.q ?? ""}))>0) and (${
      input.cursor ?? null
    }::text is null or id::text>${input.cursor ?? null}) order by id limit ${input.limit + 1}`;
    return {
      items: rows.slice(0, input.limit).map(relationDefinitionRow),
      next_cursor: rows.length > input.limit ? String(rows[input.limit - 1].id) : null,
    };
  }
  async get(id: string) {
    const [r] = await this.tx`select * from app.entity_relation_definitions where id=${id}::uuid`;
    return r ? relationDefinitionRow(r) : null;
  }
  async lock(id: string) {
    await this.lockOwner();
    const [r] = await this.tx`select * from app.entity_relation_definitions where id=${id}::uuid for update`;
    return r ? relationDefinitionRow(r) : null;
  }
  async typesAvailable(ends: EntityRelationDefinition["ends"]) {
    await this.lockOwner();
    const ids = [...new Set(ends.map((e) => e.type_id))].sort();
    const rows = await this
      .tx`select t.id, coalesce((v.schema->>'deprecated')::boolean,false) as archived from app.entity_types t join app.entity_schema_versions v on v.owner_id=t.owner_id and v.type_id=t.id and v.schema_version=t.schema_version where t.id=any(${ids}::uuid[]) order by t.id for share of t`;
    return rows.length === ids.length && rows.every((r) => !r.archived);
  }
  async hasLinks(id: string) {
    const [r] = await this
      .tx`select exists(select 1 from app.entity_relation_links where definition_id=${id}::uuid) as used`;
    return r.used as boolean;
  }
  async assertCompatible(id: string, ends: EntityRelationDefinition["ends"]) {
    const [r] = await this
      .tx`select exists(select 1 from app.entity_relation_links l join app.entities e on e.owner_id=l.owner_id and e.id=l.left_entity_id join app.entities r on r.owner_id=l.owner_id and r.id=l.right_entity_id where l.definition_id=${id}::uuid and (e.entity_type_id<>${
      ends[0].type_id
    }::uuid or r.entity_type_id<>${
      ends[1].type_id
    }::uuid)) as wrong_kind, exists(select 1 from app.entity_relation_links where definition_id=${id}::uuid group by left_entity_id having count(*)>1) as left_many, exists(select 1 from app.entity_relation_links where definition_id=${id}::uuid group by right_entity_id having count(*)>1) as right_many`;
    if (r.wrong_kind || ends[0].cardinality === "one" && r.left_many || ends[1].cardinality === "one" && r.right_many) {
      throw invalidInput("既存 연결과 맞지 않는 자료 종류·개수입니다. 연결을 먼저 정리하세요".replace("既存", "기존"));
    }
  }
  async create(ends: EntityRelationDefinition["ends"]) {
    const [a, b] = ends;
    const [r] = await this
      .tx`insert into app.entity_relation_definitions(owner_id,left_type_id,left_label,left_cardinality,right_type_id,right_label,right_cardinality) values(${this.actor.userId},${a.type_id},${a.label},${a.cardinality},${b.type_id},${b.label},${b.cardinality}) returning *`;
    return relationDefinitionRow(r);
  }
  async update(id: string, ends: EntityRelationDefinition["ends"], archived: boolean) {
    const [a, b] = ends;
    const [r] = await this
      .tx`update app.entity_relation_definitions set left_type_id=${a.type_id},left_label=${a.label},left_cardinality=${a.cardinality},right_type_id=${b.type_id},right_label=${b.label},right_cardinality=${b.cardinality},archived=${archived},version=version+1 where id=${id}::uuid returning *`;
    return relationDefinitionRow(r);
  }
  async delete(id: string) {
    await this.tx`delete from app.entity_relation_definitions where id=${id}::uuid`;
  }
}
export class SqlEntityRelationDefinitionUnitOfWork {
  constructor(private readonly sql: postgres.Sql) {}
  run<T>(actor: Actor, fn: (store: EntityRelationDefinitionStore) => Promise<T>): Promise<T> {
    return runAsActor(this.sql, actor, (tx) => fn(new SqlEntityRelationDefinitionStore(tx, actor)));
  }
}

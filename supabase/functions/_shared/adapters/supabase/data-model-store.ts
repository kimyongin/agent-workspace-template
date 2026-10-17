import type postgres from "postgres";
import type { Actor } from "../../core/shared/actor.ts";
import type { RequestIdentity } from "../../core/shared/request.ts";
import type { DataModelStore, ModelPlan, ModelSnapshot } from "../../core/data-model/application.ts";
import type { DataModelDocument, ModelChange } from "../../contracts/data-model.ts";
import { APP_IDENTIFIER_RULE_ID } from "../../contracts/entity-issuer.ts";
import { canonical } from "../../core/entity-types/evolution.ts";
import { AppError, invalidInput } from "../../core/shared/errors.ts";
import { assertTypeIdentityUpdate } from "../../core/entity-issuers/domain.ts";
import { assertSchemaTemplateReferences } from "../../core/entity-types/template-references.ts";
import { SqlEntityIssuerStore } from "./entity-issuer-store.ts";
import { SqlEntityRelationDefinitionStore } from "./entity-relation-definition-store.ts";
import { executeSqlRequest } from "./request-ledger.ts";
import { runAsActor } from "./sql-context.ts";
const ref = (id: string) => "type_" + id;
function changeRow(r: postgres.Row): ModelChange & { plan: ModelPlan } {
  return {
    id: r.id,
    version: Number(r.version),
    status: r.status,
    review: r.plan.review,
    plan: r.plan,
    result: r.result,
    created_at: r.created_at.toISOString(),
  };
}
function receiptChange(value: ModelChange): ModelChange {
  return {
    ...value,
    review: {
      ...value.review,
      items: value.review.items.map(({ schema: _s, current_schema: _c, ...item }) => ({ ...item, diff: [] })),
    },
  };
}
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
export class SqlDataModelStore implements DataModelStore {
  constructor(protected readonly tx: postgres.TransactionSql, protected readonly actor: Actor) {}
  executeRequest<T>(r: RequestIdentity, fn: () => Promise<T>) {
    return executeSqlRequest(this.tx, this.actor, r, fn);
  }
  async snapshot(): Promise<ModelSnapshot> {
    const tx = this.tx, issuers = new SqlEntityIssuerStore(tx, this.actor);
    const rows =
      await tx`select t.id,t.next_property_number,t.schema_write_locked,v.schema,(select count(*)::int from app.entities e where e.entity_type_id=t.id) as count,app.entity_schema_membership(t.owner_id,t.id) as membership from app.entity_types t join app.entity_schema_versions v on v.owner_id=t.owner_id and v.type_id=t.id and v.schema_version=t.schema_version order by t.id`;
    const types: ModelSnapshot["types"] = {};
    const entity_types: DataModelDocument["entity_types"] = [];
    for (const row of rows) {
      const i = (await issuers.getTypeIdentity(row.id))!;
      entity_types.push({
        ref: ref(row.id),
        schema: row.schema,
        identity: {
          version: i.version,
          label: i.label,
          default_source: i.default_source,
          sources: i.sources.map((s) => ({ code: s.code, rule_id: s.rule_id, active: s.active })),
        },
      });
      types[row.id] = {
        next_property_number: Number(row.next_property_number),
        count: Number(row.count),
        locked: row.schema_write_locked,
        ...{ membership: row.membership },
      };
    }
    const relations = await tx`select * from app.entity_relation_definitions order by id`;
    const ir =
      await tx`select id,source,label,meaning,generation,active,version from app.entity_identifier_rules order by id`;
    const document: DataModelDocument = {
      format: "workspace-data-model",
      format_version: 1,
      title: "자료 모델",
      entity_types,
      relations: relations.map((r) => ({
        id: r.id,
        version: r.version,
        archived: r.archived,
        ends: [{ type_ref: ref(r.left_type_id), label: r.left_label, cardinality: r.left_cardinality }, {
          type_ref: ref(r.right_type_id),
          label: r.right_label,
          cardinality: r.right_cardinality,
        }],
      })),
      identity_definitions: {
        issuers: await issuers.listIssuers(),
        rules: ir.map((r) => ({
          id: r.id,
          source: r.source,
          label: r.label,
          meaning: r.meaning,
          generation: r.generation,
          active: r.active,
          version: r.version,
        })),
      },
    };
    return { document, types };
  }
  async save(plan: ModelPlan) {
    const [r] = await this.tx`insert into app.data_model_changes(owner_id,status,plan) values(${this.actor.userId},${
      plan.review.can_apply ? "ready" : "needs_conversion"
    },${this.tx.json(plan as never)}) returning *`;
    const { plan: _p, ...value } = changeRow(r);
    return receiptChange(value);
  }
  async get(id: string, lock = false) {
    const [r] = await this.tx`select * from app.data_model_changes where id=${id}::uuid ${
      lock ? this.tx`for update` : this.tx``
    }`;
    return r ? changeRow(r) : null;
  }
  async list(limit: number, cursor?: string) {
    const rows = await this.tx`select * from app.data_model_changes where (${cursor ?? null}::uuid is null or id>${
      cursor ?? null
    }::uuid) order by id limit ${limit + 1}`;
    return {
      items: rows.slice(0, limit).map((r) => {
        const { plan: _p, ...v } = changeRow(r);
        return v;
      }),
      next_cursor: rows.length > limit ? rows[limit - 1].id : null,
    };
  }
  async publishPreparedModel(plan: ModelPlan) {
    const tx = this.tx, target = plan.target, source = plan.source, registry = new SqlEntityIssuerStore(tx, this.actor);
    // All callers own one transaction. No public use case is called from this publication port.
    const [count] = await tx`select count(*)::int as n from app.entity_types`;
    if (
      Number(count.n) +
          plan.review.items.filter((i) => i.kind === "new" && target.entity_types.some((t) => t.ref === i.ref)).length >
        64
    ) throw invalidInput("자료 종류는 64개까지 만들 수 있습니다");
    for (const t of target.entity_types) {
      const old = source.entity_types.find((o) => o.schema["x-type-id"] === t.schema["x-type-id"]);
      if (old) {
        const [row] = await tx`select schema_write_locked from app.entity_types where id=${
          t.schema["x-type-id"]
        }::uuid for update`;
        if (row.schema_write_locked) {
          throw new AppError("schema_migration_in_progress", "값 변환이 진행 중인 자료 종류입니다");
        }
      }
    }
    const [settings] = await tx`select settings from app.user_business_settings where id='record_templates'`;
    for (const t of target.entity_types) {
      assertSchemaTemplateReferences({ schema: t.schema }, settings?.settings ?? {}, t.schema["x-type-id"]);
    }
    for (const i of target.identity_definitions.issuers) {
      const old = source.identity_definitions.issuers.find((o) => o.code === i.code);
      if (i.system) {
        if (!old) {
          await tx`insert into app.entity_issuers(owner_id,code,label,active,system) values(${this.actor.userId},'app','앱',true,true)`;
        }
        continue;
      }
      if (!old) {
        await tx`insert into app.entity_issuers(owner_id,code,label,active,system) values(${this.actor.userId},${i.code},${i.label},${i.active},false)`;
      } else if (!same({ label: old.label, active: old.active }, { label: i.label, active: i.active })) {
        await tx`update app.entity_issuers set label=${i.label},active=${i.active},version=version+1 where code=${i.code}`;
      }
    }
    for (const rule of target.identity_definitions.rules) {
      const old = source.identity_definitions.rules.find((o) => o.id === rule.id);
      if (rule.id === APP_IDENTIFIER_RULE_ID && old) continue;
      if (!old) {
        await tx`insert into app.entity_identifier_rules(owner_id,id,source,label,meaning,generation,active) values(${this.actor.userId},${rule.id}::uuid,${rule.source},${rule.label},${rule.meaning},${rule.generation},${rule.active})`;
      } else if (
        !same({ label: old.label, meaning: old.meaning, active: old.active }, {
          label: rule.label,
          meaning: rule.meaning,
          active: rule.active,
        })
      ) {
        if (old.source !== rule.source || old.generation !== rule.generation) {
          throw invalidInput("번호 종류의 발급처·방식은 변경할 수 없습니다");
        }
        await tx`update app.entity_identifier_rules set label=${rule.label},meaning=${rule.meaning},active=${rule.active},version=version+1 where id=${rule.id}::uuid`;
      }
    }
    for (const t of target.entity_types) {
      const id = t.schema["x-type-id"],
        old = source.entity_types.find((o) => o.schema["x-type-id"] === id),
        item = plan.review.items.find((i) => i.ref === t.ref)!;
      if (!old) {
        await tx`insert into app.entity_types(owner_id,id,next_property_number) values(${this.actor.userId},${id}::uuid,${
          Math.max(1, ...Object.keys(t.schema.properties).map((k) => Number(k.slice(5)))) + 1
        })`;
      }
      if (!old || item.diff.length) {
        await tx`insert into app.entity_schema_versions(owner_id,schema) values(${this.actor.userId},${
          tx.json(t.schema as never)
        })`;
        await tx`update app.entity_types set schema_version=${
          t.schema["x-version"]
        },next_property_number=greatest(next_property_number,${
          Math.max(1, ...Object.keys(t.schema.properties).map((k) => Number(k.slice(5)))) + 1
        }),updated_at=now() where id=${id}::uuid`;
      }
      const input = {
        label: t.identity.label,
        default_source: t.identity.default_source,
        sources: t.identity.sources,
        expected_version: old?.identity.version ?? 1,
      };
      if (!old) {
        await tx`insert into app.entity_type_identity(owner_id,type_id,label,default_source) values(${this.actor.userId},${id}::uuid,${input.label},${input.default_source})`;
        for (const s of input.sources) {
          await tx`insert into app.entity_type_identity_sources(owner_id,type_id,code,rule_id,active) values(${this.actor.userId},${id}::uuid,${s.code},${s.rule_id}::uuid,${s.active})`;
        }
      } else if (
        !same(
          { label: old.identity.label, default_source: old.identity.default_source, sources: old.identity.sources },
          { label: input.label, default_source: input.default_source, sources: input.sources },
        )
      ) {
        const current = (await registry.getTypeIdentity(id, true))!;
        assertTypeIdentityUpdate(current, input, await registry.identitySourceAvailability(input.sources));
        await registry.updateTypeIdentity(id, input);
      }
    }
    for (const relation of target.relations) {
      const old = source.relations.find((o) => o.id === relation.id);
      const ends = relation.ends.map((e) => ({
        type_id: plan.review.mapping.types[e.type_ref],
        label: e.label,
        cardinality: e.cardinality,
      }));
      const oldEnds = old?.ends.map((e) => ({
        type_id: source.entity_types.find((t) => t.ref === e.type_ref)!.schema["x-type-id"],
        label: e.label,
        cardinality: e.cardinality,
      }));
      if (old && same(ends, oldEnds) && old.archived === relation.archived) continue;
      await new SqlEntityRelationDefinitionStore(tx, this.actor).assertCompatible(
        relation.id,
        ends as import("../../contracts/entity-relation.ts").EntityRelationDefinition["ends"],
      );
      await tx`select app.publish_data_model_relation(${relation.id}::uuid,${old?.version ?? null}::integer,${
        tx.json(ends)
      },${relation.archived})`;
    }
    return {
      type_ids: target.entity_types.map((t) => t.schema["x-type-id"]),
      relation_ids: target.relations.map((t) => t.id),
    };
  }
  async complete(id: string, result: NonNullable<ModelChange["result"]>) {
    const [r] = await this.tx`update app.data_model_changes set status='applied',version=version+1,result=${
      this.tx.json(result)
    } where id=${id}::uuid returning *`;
    const { plan: _p, ...value } = changeRow(r);
    return receiptChange(value);
  }
}
export class SqlDataModelUnitOfWork {
  constructor(private readonly sql: postgres.Sql) {}
  run<T>(a: Actor, fn: (s: DataModelStore) => Promise<T>) {
    return runAsActor(this.sql, a, async (tx) => {
      // Before any model/type/entity row lock, share relation-definition writer ordering.
      await tx`select pg_advisory_xact_lock(hashtextextended(${a.userId + ":entity-relations"},0))`;
      await tx`select pg_advisory_xact_lock(hashtextextended(${a.userId + ":entity-types"},0))`;
      await tx`select id from app.entity_relation_definitions order by id for update`;
      await tx`select id from app.entity_types order by id for update`;
      for (const suffix of [":entity-identity-registry", ":record_templates"]) {
        await tx`select pg_advisory_xact_lock(hashtextextended(${a.userId + suffix},0))`;
      }
      return fn(new SqlDataModelStore(tx, a));
    }, "repeatable read");
  }
}

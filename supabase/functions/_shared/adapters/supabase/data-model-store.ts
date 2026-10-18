import type postgres from "postgres";
import type { Actor } from "../../core/shared/actor.ts";
import type { RequestIdentity } from "../../core/shared/request.ts";
import type { DataModelStore, ModelPlan, ModelSnapshot } from "../../core/data-model/application.ts";
import type { DataModelDocument, ModelChange } from "../../contracts/data-model.ts";
import { invalidInput } from "../../core/shared/errors.ts";
import { assertSchemaTemplateReferences } from "../../core/entity-types/template-references.ts";
import { SqlEntityIssuerStore } from "./entity-issuer-store.ts";
import { executeSqlRequest } from "./request-ledger.ts";
import { requireWorkspaceActor, runInWorkspace } from "./workspace-context.ts";
import type { WorkspaceEntry } from "../../core/workspaces/application.ts";
import { decodeCursor, paginate, scopeOf } from "../../core/shared/operations.ts";
import { z } from "zod";
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
export function receiptChange(value: ModelChange): ModelChange {
  return {
    id: value.id,
    version: value.version,
    status: value.status,
    result: value.result,
    created_at: value.created_at,
    ...(value.group ? { group: { ...value.group, children: [] } } : {}),
    review: {
      ...value.review,
      items: value.review.items.map((
        { schema: _s, current_schema: _c, identity: _i, current_identity: _ci, ...item },
      ) => ({ ...item, diff: [] })),
    },
  };
}
export class SqlDataModelStore implements DataModelStore {
  protected get workspaceId(): string {
    return requireWorkspaceActor(this.actor).workspaceId;
  }
  constructor(protected readonly tx: postgres.TransactionSql, protected readonly actor: Actor) {}
  executeRequest<T>(r: RequestIdentity, fn: () => Promise<T>) {
    return executeSqlRequest(this.tx, this.actor, r, fn);
  }
  async exportDocument(): Promise<DataModelDocument> {
    const [row] = await this.tx`select app.export_workspace_data_model() as document`;
    return row.document as DataModelDocument;
  }
  async snapshot(): Promise<ModelSnapshot> {
    const tx = this.tx, issuers = new SqlEntityIssuerStore(tx, this.actor);
    const rows =
      await tx`select t.id,t.next_property_number,t.schema_write_locked,v.schema,(select count(*)::int from app.entities e where e.workspace_id=t.workspace_id and e.entity_type_id=t.id) as count,app.entity_schema_membership(t.workspace_id,t.id) as membership from app.entity_types t join app.entity_schema_versions v on v.workspace_id=t.workspace_id and v.type_id=t.id and v.schema_version=t.schema_version order by t.id`;
    const types: ModelSnapshot["types"] = {};
    const entity_types: DataModelDocument["entity_types"] = [];
    const identity_usage: NonNullable<ModelSnapshot["identity_usage"]> = {};
    for (const row of rows) {
      const i = (await issuers.getTypeIdentity(row.id))!;
      const rawSources =
        await tx`select code,rule_id,active,referenced from app.entity_type_identity_sources where type_id=${row.id}::uuid order by code`;
      identity_usage[row.id] = Object.fromEntries(
        rawSources.filter((s) => s.referenced).map((s) => [String(s.code), String(s.rule_id)]),
      );
      entity_types.push({
        ref: ref(row.id),
        schema: row.schema,
        identity: {
          version: i.version,
          label: i.label,
          default_source: i.default_source,
          sources: rawSources.map((s) => ({
            code: String(s.code),
            rule_id: String(s.rule_id),
            active: Boolean(s.active),
          })),
        },
      });
      types[row.id] = {
        next_property_number: Number(row.next_property_number),
        count: Number(row.count),
        locked: row.schema_write_locked,
        ...{ membership: row.membership },
      };
    }
    const relations =
      await tx`select * from app.entity_relation_definitions where workspace_id=${this.workspaceId} order by id`;
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
    const used =
      await tx`select r.id,exists(select 1 from app.entity_type_identity_sources s where s.rule_id=r.id and s.referenced) as referenced from app.entity_identifier_rules r`;
    const usage = await tx`select d.id,
      (select count(*)::int from app.entity_relation_links l where l.workspace_id=d.workspace_id and l.definition_id=d.id) as links,
      exists(select 1 from app.entity_relation_links l where l.workspace_id=d.workspace_id and l.definition_id=d.id group by l.left_entity_id having count(*)>1) as left_many,
      exists(select 1 from app.entity_relation_links l where l.workspace_id=d.workspace_id and l.definition_id=d.id group by l.right_entity_id having count(*)>1) as right_many
      from app.entity_relation_definitions d where d.workspace_id=${this.workspaceId}::uuid`;
    return {
      document,
      types,
      identity_usage,
      relation_usage: Object.fromEntries(
        usage.map(
          (r) => [String(r.id), {
            links: Number(r.links),
            left_many: Boolean(r.left_many),
            right_many: Boolean(r.right_many),
          }],
        ),
      ),
      rule_usage: Object.fromEntries(used.map((r) => [String(r.id), Boolean(r.referenced)])),
    };
  }
  async save(plan: ModelPlan) {
    const [r] = await this.tx`insert into app.data_model_changes(workspace_id,status,plan) values(${this.workspaceId},${
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
    const scope = await scopeOf(this.actor, { list: "data-model-changes" });
    const after = cursor ? decodeCursor(cursor, scope).id : null;
    if (after) {
      if (!z.string().uuid().safeParse(after).success) throw invalidInput("유효하지 않은 cursor입니다");
      const [anchor] = await this
        .tx`select id from app.data_model_changes where workspace_id=${this.workspaceId}::uuid and id=${after}::uuid`;
      if (!anchor) throw invalidInput("cursor의 기준 이력이 없습니다. 목록을 다시 조회하세요");
    }
    const rows = await this
      .tx`select * from app.data_model_changes where workspace_id=${this.workspaceId}::uuid and (${after}::uuid is null or id>${after}::uuid) order by id limit ${
      limit + 1
    }`;
    return paginate(
      rows.map((r) => {
        const { plan: _p, ...value } = changeRow(r);
        return receiptChange(value);
      }),
      limit,
      () => "1970-01-01T00:00:00.000Z",
      scope,
    );
  }
  async publishPreparedModel(plan: ModelPlan, id: string) {
    const [settings] = await this.tx`select settings from app.user_business_settings where id='record_templates'`;
    for (const type of plan.target.entity_types) {
      assertSchemaTemplateReferences({ schema: type.schema }, settings?.settings ?? {}, type.schema["x-type-id"]);
    }
    const [change] = await this.tx`select version from app.data_model_changes where id=${id}::uuid`;
    const [row] = await this
      .tx`select app.publish_prepared_data_model(${id}::uuid,${change.version}::integer) as result`;
    return row.result as NonNullable<ModelChange["result"]>;
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
  constructor(
    private readonly sql: postgres.Sql,
    private readonly Store: typeof SqlDataModelStore = SqlDataModelStore,
  ) {}
  run<T>(a: Actor, fn: (s: DataModelStore) => Promise<T>, readOnly = false, entry?: WorkspaceEntry) {
    const workspaceActor = requireWorkspaceActor(a);
    return runInWorkspace(
      this.sql,
      workspaceActor,
      entry ??
        {
          mode: "business",
          requirements: [{ target_kind: "settings", target_id: "*", access: readOnly ? "read" : "write" }],
        },
      async (tx) => {
        // Before any model/type/entity row lock, share relation-definition writer ordering.
        await tx`select pg_advisory_xact_lock(hashtextextended(${workspaceActor.workspaceId + ":entity-relations"},0))`;
        await tx`select pg_advisory_xact_lock(hashtextextended(${workspaceActor.workspaceId + ":entity-types"},0))`;
        if (!readOnly) {
          await tx`select id from app.entity_relation_definitions where workspace_id=${workspaceActor.workspaceId} order by id for update`;
          await tx`select id from app.entity_types where workspace_id=${workspaceActor.workspaceId} order by id for update`;
        }
        for (const suffix of [":entity-identity-registry", ":record_templates"]) {
          await tx`select pg_advisory_xact_lock(hashtextextended(${workspaceActor.workspaceId + suffix},0))`;
        }
        return fn(new this.Store(tx, a));
      },
    );
  }
}

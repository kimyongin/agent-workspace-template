import type postgres from "postgres";
import { normalizeStoredEntityDefinition } from "../../core/entity-types/stored-definition.ts";
import type { Actor } from "../../core/shared/actor.ts";
import type { RequestIdentity } from "../../core/shared/request.ts";
import {
  type DataModelStore,
  type ModelPlan,
  type ModelSnapshot,
  resolveModel,
} from "../../core/data-model/application.ts";
import type { DataModelDocument, ModelChange } from "../../contracts/data-model.ts";
import { invalidInput } from "../../core/shared/errors.ts";
import { assertSchemaTemplateReferences } from "../../core/entity-types/template-references.ts";
import { executeSqlRequest } from "./request-ledger.ts";
import { schemaDefinitionDiff } from "../../core/entity-types/evolution.ts";
import { authorizeWorkspace, requireWorkspaceActor, runInWorkspace } from "./workspace-context.ts";
import type { WorkspaceEntry, WorkspaceRequirement } from "../../core/workspaces/application.ts";
import { decodeCursor, paginate, scopeOf } from "../../core/shared/operations.ts";
import { z } from "zod";
function changeRow(r: postgres.Row): ModelChange & { plan: ModelPlan } {
  return {
    id: r.id,
    version: Number(r.version),
    status: r.status,
    // Review is a read projection; the raw plan below still owns its approval fingerprint.
    review: {
      ...r.plan.review,
      items: r.plan.review.items.map((item: ModelChange["review"]["items"][number]) => ({
        ...item,
        ...Object.fromEntries((["schema", "current_schema"] as const).flatMap((key) => {
          const schema = item[key];
          return schema ? [[key, normalizeStoredEntityDefinition({ schema }, schema["x-type-id"], schema["x-version"]).schema]] : [];
        })),
      })),
    },
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
  protected authorizeKinds(ids: string[], access: "read" | "write") {
    return this.authorizePermissions(
      [...new Set(ids)].sort().map((id) => ({ target_kind: "entity_type", target_id: id, access })),
    );
  }
  protected async authorizePermissions(requirements: WorkspaceRequirement[]) {
    if (!requirements.length) return;
    await authorizeWorkspace(this.tx, requirements);
    await this.tx`select set_config('request.workspace_requirements',
      (current_setting('request.workspace_requirements',true)::jsonb||${
      this.tx.json(requirements as never)
    }::jsonb)::text,true)`;
  }
  async exportDocument(): Promise<DataModelDocument> {
    const [row] = await this.tx`select app.export_workspace_data_model() as document`;
    return row.document as DataModelDocument;
  }
  async snapshot(intent?: { document: DataModelDocument; mode: "update" | "copy" }): Promise<ModelSnapshot> {
    const document = await this.exportDocument();
    const rows = await this.tx`select id,next_property_number,schema_write_locked from app.entity_types
      where workspace_id=${this.workspaceId}::uuid order by id`;
    const snapshot: ModelSnapshot = {
      document,
      types: Object.fromEntries(rows.map((r) => [r.id, {
        next_property_number: Number(r.next_property_number),
        count: 0,
        locked: r.schema_write_locked,
      }])),
      identity_usage: {},
      rule_usage: {},
      relation_usage: {},
    };
    if (!intent || intent.mode === "copy") return snapshot;
    const mapped = await resolveModel(snapshot, intent.document, intent.mode, this.workspaceId);
    const kinds = new Set<string>(), relations = new Set<string>(), rules = new Set<string>();
    for (const target of mapped.target.entity_types) {
      const id = target.schema["x-type-id"], old = document.entity_types.find((t) => t.schema["x-type-id"] === id);
      if (!old) continue;
      if (
        schemaDefinitionDiff({ schema: old.schema }, { schema: target.schema }).some((d) =>
          d.kind === "migration_required"
        ) ||
        old.identity.sources.some((source) =>
          !target.identity.sources.some((n) => n.code === source.code && n.rule_id === source.rule_id)
        )
      ) {
        kinds.add(id);
      }
    }
    for (const target of mapped.target.identity_definitions.rules) {
      const old = document.identity_definitions.rules.find((r) => r.id === target.id);
      if (!old || old.meaning === target.meaning) continue;
      rules.add(old.id);
      for (const type of document.entity_types) {
        if (type.identity.sources.some((source) => source.rule_id === old.id)) kinds.add(type.schema["x-type-id"]);
      }
    }
    const ends = (r: DataModelDocument["relations"][number], d: DataModelDocument) =>
      r.ends.map((e) => ({
        type: d.entity_types.find((t) => t.ref === e.type_ref)?.schema["x-type-id"],
        cardinality: e.cardinality,
      }));
    for (const target of mapped.target.relations) {
      const old = document.relations.find((r) => r.id === target.id);
      if (!old || JSON.stringify(ends(old, document)) === JSON.stringify(ends(target, mapped.target))) continue;
      relations.add(old.id);
      for (const e of [...ends(old, document), ...ends(target, mapped.target)]) {
        if (e.type && snapshot.types[e.type]) kinds.add(e.type);
      }
    }
    if (!kinds.size) return snapshot;
    const ids = [...kinds].sort();
    // Resolve targets from current stored definitions, then authorize before
    // count, membership, reference flags or link cardinality reveal values.
    await this.authorizeKinds(ids, "write");
    const facts = await this.tx`select t.id,
      (select count(*)::int from app.entities e where e.workspace_id=t.workspace_id and e.entity_type_id=t.id) as count,
      app.entity_schema_membership(t.workspace_id,t.id) as membership
      from app.entity_types t where t.workspace_id=${this.workspaceId}::uuid and t.id=any(${ids}::uuid[]) order by t.id`;
    for (const row of facts) {
      Object.assign(snapshot.types[row.id], { count: Number(row.count), membership: row.membership });
    }
    const sources = await this.tx`select type_id,code,rule_id,referenced from app.entity_type_identity_sources
      where workspace_id=${this.workspaceId}::uuid and type_id=any(${ids}::uuid[]) order by type_id,code`;
    for (const source of sources) {
      if (source.referenced) (snapshot.identity_usage![source.type_id] ??= {})[source.code] = source.rule_id;
      if (source.referenced && rules.has(source.rule_id)) snapshot.rule_usage![source.rule_id] = true;
    }
    if (relations.size) {
      const usage = await this.tx`select d.id,
        (select count(*)::int from app.entity_relation_links l where l.workspace_id=d.workspace_id and l.definition_id=d.id) as links,
        exists(select 1 from app.entity_relation_links l where l.workspace_id=d.workspace_id and l.definition_id=d.id group by l.left_entity_id having count(*)>1) as left_many,
        exists(select 1 from app.entity_relation_links l where l.workspace_id=d.workspace_id and l.definition_id=d.id group by l.right_entity_id having count(*)>1) as right_many
        from app.entity_relation_definitions d where d.workspace_id=${this.workspaceId}::uuid and d.id=any(${[
        ...relations,
      ]}::uuid[])`;
      for (const r of usage) {
        snapshot.relation_usage![r.id] = { links: Number(r.links), left_many: r.left_many, right_many: r.right_many };
      }
    }
    return snapshot;
  }
  async save(plan: ModelPlan) {
    const [context] = await this.tx`select current_setting('request.workspace_requirements',true) as requirements`;
    const requirements = JSON.parse(context.requirements) as WorkspaceRequirement[];
    const protectedPermissions = new Map<string, WorkspaceRequirement>();
    for (const requirement of requirements.filter((r) => r.target_kind !== "settings")) {
      if (protectedPermissions.get(`${requirement.target_kind}:${requirement.target_id}`)?.access !== "write") {
        protectedPermissions.set(`${requirement.target_kind}:${requirement.target_id}`, requirement);
      }
    }
    plan = {
      ...plan,
      protected_kind_ids: [...protectedPermissions.values()].filter((r) =>
        r.target_kind === "entity_type" && r.access === "write"
      ).map((r) => r.target_id)
        .sort(),
      protected_permissions: [...protectedPermissions.values()],
    };
    const [r] = await this.tx`insert into app.data_model_changes(workspace_id,status,plan) values(${this.workspaceId},${
      plan.review.can_apply ? "ready" : "needs_conversion"
    },${this.tx.json(plan as never)}) returning *`;
    const { plan: _p, ...value } = changeRow(r);
    return receiptChange(value);
  }
  async get(id: string, lock = false) {
    const [targets] = await this
      .tx`select requirements from app.workspace_model_plan_headers(${id}::uuid)`;
    if (!targets) return null;
    await this.authorizePermissions(
      (targets.requirements as WorkspaceRequirement[]).map((r) => ({ ...r, access: "read" })),
    );
    const [r] = await this
      .tx`select * from app.data_model_changes where workspace_id=${this.workspaceId} and id=${id}::uuid ${
      lock ? this.tx`for update` : this.tx``
    }`;
    return r ? changeRow(r) : null;
  }
  async list(limit: number, cursor?: string) {
    const scope = await scopeOf(this.actor, { workspace_id: this.workspaceId, list: "data-model-changes" });
    const after = cursor ? decodeCursor(cursor, scope).id : null;
    if (after) {
      if (!z.string().uuid().safeParse(after).success) throw invalidInput("유효하지 않은 cursor입니다");
      const [anchor] = await this
        .tx`select id from app.workspace_model_plan_headers(${after}::uuid)`;
      if (!anchor) throw invalidInput("cursor의 기준 이력이 없습니다. 목록을 다시 조회하세요");
    }
    const candidates = await this
      .tx`select id,requirements from app.workspace_model_plan_headers(null,${after}::uuid,${limit + 1}::integer)`;
    await this.authorizePermissions(
      candidates.flatMap((r) =>
        (r.requirements as WorkspaceRequirement[]).map((p) => ({ ...p, access: "read" as const }))
      ),
    );
    const rows = candidates.length
      ? await this.tx`select * from app.data_model_changes
      where workspace_id=${this.workspaceId}::uuid and id=any(${candidates.map((r) => r.id)}::uuid[]) order by id`
      : [];
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
    const [settings] = await this
      .tx`select settings from app.user_business_settings where workspace_id=${this.workspaceId}::uuid and id='record_templates'`;
    for (const type of plan.target.entity_types) {
      assertSchemaTemplateReferences({ schema: type.schema }, settings?.settings ?? {}, type.schema["x-type-id"]);
    }
    const [change] = await this
      .tx`select version from app.data_model_changes where workspace_id=${this.workspaceId}::uuid and id=${id}::uuid`;
    const [row] = await this
      .tx`select app.publish_prepared_data_model(${id}::uuid,${change.version}::integer) as result`;
    return row.result as NonNullable<ModelChange["result"]>;
  }
  async complete(id: string, result: NonNullable<ModelChange["result"]>) {
    const [r] = await this.tx`update app.data_model_changes set status='applied',version=version+1,result=${
      this.tx.json(result)
    } where workspace_id=${this.workspaceId}::uuid and id=${id}::uuid returning *`;
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

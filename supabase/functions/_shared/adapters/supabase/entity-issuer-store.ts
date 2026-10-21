import { requireWorkspaceActor, runInWorkspace } from "./workspace-context.ts";
import type { WorkspaceEntry } from "../../core/workspaces/application.ts";
import type postgres from "postgres";
import type { Actor } from "../../core/shared/actor.ts";
import type { EntityIssuerStore } from "../../core/entity-issuers/application.ts";
import type { EntityIssuer, IdentifierRule } from "../../contracts/entity-issuer.ts";
import { APP_IDENTIFIER_RULE_ID } from "../../contracts/entity-issuer.ts";
import { AppError, notFound } from "../../core/shared/errors.ts";
import { executeSqlRequest } from "./request-ledger.ts";
import type { RequestIdentity } from "../../core/shared/request.ts";
function issuer(row: postgres.Row): EntityIssuer {
  return { code: row.code, label: row.label, active: row.active, system: row.system, version: Number(row.version) };
}
function rule(row: postgres.Row): IdentifierRule {
  return {
    id: row.id,
    source: row.source,
    label: row.label,
    meaning: row.meaning,
    generation: row.generation,
    active: row.active,
    version: Number(row.version),
  };
}
export class SqlEntityIssuerStore implements EntityIssuerStore {
  private get workspaceId(): string {
    return requireWorkspaceActor(this.actor).workspaceId;
  }
  constructor(private readonly tx: postgres.TransactionSql, private readonly actor: Actor) {}
  executeRequest<T>(request: RequestIdentity, execute: () => Promise<T>) {
    return executeSqlRequest(this.tx, this.actor, request, execute);
  }
  async listIssuers() {
    return (await this.tx`select * from app.entity_issuers order by code`).map(issuer);
  }
  async countIssuersForUpdate() {
    await this.lockOwner();
    const [row] = await this.tx`select count(*)::int as count from app.entity_issuers`;
    return row.count as number;
  }
  async lockIssuer(code: string) {
    await this.lockOwner();
    const [row] = await this.tx`select * from app.entity_issuers where code=${code} for update`;
    return row ? issuer(row) : null;
  }
  async defaultTypes(source: string, ruleId?: string) {
    const rows = await this.tx`select distinct t.id,v.schema->>'title' as label from app.entity_types t
      join app.entity_schema_versions v on v.workspace_id=t.workspace_id and v.type_id=t.id and v.schema_version=t.schema_version
      cross join lateral jsonb_each(v.schema->'properties') f
      join app.entity_identifier_rules r on r.workspace_id=t.workspace_id and r.id::text=f.value->'x-identifier'->>'default_kind_id'
      where r.source=${source} and (${ruleId ?? null}::uuid is null or r.id=${ruleId ?? null}::uuid) order by t.id`;
    return rows.map((row) => ({ type_id: row.id as string, label: row.label as string }));
  }
  async issuerHasDependencies(code: string) {
    const [row] = await this.tx`select exists(select 1 from app.entity_identifier_rules where source=${code}) as used`;
    return row.used as boolean;
  }
  async ruleHasDependencies(id: string) {
    const [row] = await this.tx`select exists(select 1 from app.entity_schema_versions v,
      lateral jsonb_each(v.schema->'properties') f where f.value->'x-identifier'->'allowed_kind_ids' ? ${id}) as used`;
    return row.used as boolean;
  }
  async deleteIssuer(code: string) {
    await this.tx`delete from app.entity_issuers where code=${code}`;
  }
  async deleteRule(id: string) {
    await this.tx`delete from app.entity_identifier_rules where id=${id}::uuid`;
  }
  async countRules(source: string) {
    const [row] = await this.tx`select count(*)::int as count from app.entity_identifier_rules where source=${source}`;
    return row.count as number;
  }
  async lockRule(id: string) {
    await this.lockOwner();
    const [row] = await this.tx`select * from app.entity_identifier_rules where id=${id}::uuid for update`;
    return row ? rule(row) : null;
  }
  async ruleUsage(id: string, inspectReferences = true) {
    const [rule] = await this.tx`select source from app.entity_identifier_rules where id=${id}::uuid`;
    return {
      referenced: inspectReferences && await this.ruleHasDependencies(id),
      defaultTypes: rule ? await this.defaultTypes(rule.source, id) : [],
    };
  }
  async createIssuer(input: Parameters<EntityIssuerStore["createIssuer"]>[0]) {
    const [row] = await this
      .tx`insert into app.entity_issuers(workspace_id,code,label) values(${this.workspaceId},${input.code},${input.label}) returning *`;
    return issuer(row);
  }
  async updateIssuer(code: string, input: Parameters<EntityIssuerStore["updateIssuer"]>[1]) {
    const [row] = await this.tx`update app.entity_issuers set label=coalesce(${
      input.label ?? null
    },label),active=coalesce(${
      input.active ?? null
    }::boolean,active),version=version+1 where code=${code} and version=${input.expected_version} returning *`;
    if (!row) throw new AppError("settings_changed", "설정이 변경되었습니다. 최신 버전을 확인하세요");
    return issuer(row);
  }
  async listRules(source: string) {
    const [r] = await this.tx`select 1 from app.entity_issuers where code=${source}`;
    if (!r) throw notFound();
    return (await this.tx`select * from app.entity_identifier_rules where source=${source} order by id`).map(rule);
  }
  async createRule(source: string, input: Parameters<EntityIssuerStore["createRule"]>[1]) {
    const [row] = await this
      .tx`insert into app.entity_identifier_rules(workspace_id,source,label,meaning,generation) values(${this.workspaceId},${source},${input.label},${input.meaning},'direct') returning *`;
    return rule(row);
  }
  async updateRule(id: string, input: Parameters<EntityIssuerStore["updateRule"]>[1]) {
    const [row] = await this.tx`update app.entity_identifier_rules set label=coalesce(${
      input.label ?? null
    },label),meaning=coalesce(${input.meaning ?? null},meaning),active=coalesce(${
      input.active ?? null
    }::boolean,active),version=version+1 where id=${id}::uuid and version=${input.expected_version} returning *`;
    if (!row) throw new AppError("settings_changed", "설정이 변경되었습니다. 최신 버전을 확인하세요");
    return rule(row);
  }
  private async lockOwner() {
    await this.tx`select pg_advisory_xact_lock(hashtextextended(${this.workspaceId + ":entity-identity-registry"},0))`;
  }
  async initializeRegistry() {
    await this.lockOwner();
    await this
      .tx`insert into app.entity_issuers(workspace_id,code,label,system) values(${this.workspaceId},'app','앱',true) on conflict do nothing`;
    await this
      .tx`insert into app.entity_identifier_rules(workspace_id,id,source,label,meaning,generation) values(${this.workspaceId},${APP_IDENTIFIER_RULE_ID},'app','자동 발급','앱이 발급한 자료 번호','automatic') on conflict do nothing`;
  }
}
export class SqlEntityIssuerUnitOfWork {
  constructor(private readonly sql: postgres.Sql) {}
  run<T>(
    actor: Actor,
    fn: (s: EntityIssuerStore) => Promise<T>,
    entry: WorkspaceEntry = { mode: "business", requirements: [] },
  ): Promise<T> {
    return runInWorkspace(
      this.sql,
      requireWorkspaceActor(actor),
      entry,
      (tx) => fn(new SqlEntityIssuerStore(tx, actor)),
    );
  }
}

import { requireWorkspaceActor, runInWorkspace } from "./workspace-context.ts";
import type { WorkspaceEntry } from "../../core/workspaces/application.ts";
import type postgres from "postgres";
import type { Actor } from "../../core/shared/actor.ts";
import type { EntityIssuerStore } from "../../core/entity-issuers/application.ts";
import type { EntityIssuer, EntityTypeIdentity, IdentifierRule } from "../../contracts/entity-issuer.ts";
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
    const rows = await this.tx`select t.id,v.schema->>'title' as label from app.entity_types t
      join app.entity_schema_versions v on v.workspace_id=t.workspace_id and v.type_id=t.id and v.schema_version=t.schema_version
      join app.entity_type_identity i on i.workspace_id=t.workspace_id and i.type_id=t.id
      join app.entity_type_identity_sources s on s.workspace_id=i.workspace_id and s.type_id=i.type_id and s.code=i.default_source
      where s.code=${source} and (${ruleId ?? null}::uuid is null or s.rule_id=${ruleId ?? null}::uuid) order by t.id`;
    return rows.map((row) => ({ type_id: row.id as string, label: row.label as string }));
  }
  async issuerHasDependencies(code: string) {
    const [row] = await this.tx`select exists(select 1 from app.entity_identifier_rules where source=${code})
      or exists(select 1 from app.entity_type_identity_sources where code=${code}) as used`;
    return row.used as boolean;
  }
  async ruleHasDependencies(id: string) {
    const [row] = await this
      .tx`select exists(select 1 from app.entity_type_identity_sources where rule_id=${id}::uuid) as used`;
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
    if (inspectReferences) {
      await this.tx`select private.authorize_workspace_model_kinds(array(
        select distinct type_id from app.entity_type_identity_sources
        where workspace_id=${this.workspaceId}::uuid and rule_id=${id}::uuid))`;
    }
    const [row] = inspectReferences
      ? await this.tx`select exists(select 1 from app.entity_type_identity_sources
          where rule_id=${id}::uuid and referenced) as referenced`
      : [{ referenced: false }];
    const [rule] = await this.tx`select source from app.entity_identifier_rules where id=${id}::uuid`;
    return {
      referenced: row.referenced as boolean,
      defaultTypes: rule ? await this.defaultTypes(rule.source, id) : [],
    };
  }
  async lockTypeIdentity(typeId: string, mutation?: Parameters<EntityIssuerStore["lockTypeIdentity"]>[1]) {
    await this.lockOwner();
    if (mutation) {
      const stored = await this.tx`select code,rule_id from app.entity_type_identity_sources
        where workspace_id=${this.workspaceId}::uuid and type_id=${typeId}::uuid`;
      if (stored.some((source) => !mutation.sources.some((next) =>
        next.code === source.code && next.rule_id.toLowerCase() === source.rule_id.toLowerCase()
      ))) {
        await this.tx`select private.authorize_workspace_model_kinds(array[${typeId}::uuid])`;
      }
    }
    const [row] = await this.tx`select * from app.entity_type_identity where type_id=${typeId}::uuid for update`;
    if (!row) return null;
    await this.tx`select code from app.entity_type_identity_sources where type_id=${typeId}::uuid for update`;
    return this.getTypeIdentity(typeId);
  }
  async identitySourceAvailability(sources: { code: string; rule_id: string }[]) {
    const rows = await this.tx`select i.code,r.id as rule_id,i.active as issuer_active,r.active as rule_active
      from app.entity_issuers i join app.entity_identifier_rules r on r.workspace_id=i.workspace_id and r.source=i.code
      where i.code=any(${sources.map((s) => s.code)}::text[]) and r.id=any(${sources.map((s) => s.rule_id)}::uuid[])`;
    return rows.map((row) => ({
      code: row.code as string,
      rule_id: row.rule_id as string,
      issuer_active: row.issuer_active as boolean,
      rule_active: row.rule_active as boolean,
    }));
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
  async getTypeIdentity(typeId: string, lock = false): Promise<EntityTypeIdentity | null> {
    if (lock) await this.lockOwner();
    const rows = lock
      ? await this.tx`select * from app.entity_type_identity where type_id=${typeId}::uuid for share`
      : await this.tx`select * from app.entity_type_identity where type_id=${typeId}::uuid`;
    const r = rows[0];
    if (!r) return null;
    const sources = await this
      .tx`select s.code,s.rule_id,s.referenced,(s.active and i.active and r.active) as active,i.label as source_label,r.label as rule_label,r.generation from app.entity_type_identity_sources s join app.entity_issuers i on i.workspace_id=s.workspace_id and i.code=s.code join app.entity_identifier_rules r on r.workspace_id=s.workspace_id and r.id=s.rule_id where s.type_id=${r.type_id} order by s.code`;
    return {
      type_id: r.type_id,
      label: r.label,
      default_source: r.default_source,
      version: Number(r.version),
      sources: sources.map((s) => ({
        code: s.code,
        rule_id: s.rule_id,
        active: s.active,
        referenced: s.referenced,
        source_label: s.source_label,
        rule_label: s.rule_label,
        generation: s.generation,
      })),
    };
  }
  private async lockOwner() {
    await this.tx`select pg_advisory_xact_lock(hashtextextended(${this.workspaceId + ":entity-identity-registry"},0))`;
  }
  async updateTypeIdentity(typeId: string, input: Parameters<EntityIssuerStore["updateTypeIdentity"]>[1]) {
    const old = await this.tx`select code from app.entity_type_identity_sources where type_id=${typeId}::uuid`;
    for (const s of old) {
      if (!input.sources.some((n) => n.code === s.code)) {
        await this.tx`delete from app.entity_type_identity_sources where type_id=${typeId}::uuid and code=${s.code}`;
      }
    }
    for (const s of input.sources) {
      await this
        .tx`insert into app.entity_type_identity_sources(workspace_id,type_id,code,rule_id,active) values(${this.workspaceId},${typeId}::uuid,${s.code},${s.rule_id},${s.active}) on conflict(workspace_id,type_id,code) do update set rule_id=excluded.rule_id,active=excluded.active`;
    }
    const [saved] = await this
      .tx`update app.entity_type_identity set label=${input.label},default_source=${input.default_source},version=version+1 where type_id=${typeId}::uuid and version=${input.expected_version} returning type_id`;
    if (!saved) throw new AppError("settings_changed", "설정이 변경되었습니다. 최신 버전을 확인하세요");
    return (await this.getTypeIdentity(typeId))!;
  }
  async initializeTypeIdentity(typeId: string) {
    await this.lockOwner();
    await this
      .tx`insert into app.entity_issuers(workspace_id,code,label,system) values(${this.workspaceId},'app','앱',true) on conflict do nothing`;
    await this
      .tx`insert into app.entity_identifier_rules(workspace_id,id,source,label,meaning,generation) values(${this.workspaceId},${APP_IDENTIFIER_RULE_ID},'app','자동 발급','앱이 발급한 자료 번호','automatic') on conflict do nothing`;
    await this
      .tx`insert into app.entity_type_identity(workspace_id,type_id,label,default_source) values(${this.workspaceId},${typeId},'번호','app')`;
    await this
      .tx`insert into app.entity_type_identity_sources(workspace_id,type_id,code,rule_id) values(${this.workspaceId},${typeId},'app',${APP_IDENTIFIER_RULE_ID})`;
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

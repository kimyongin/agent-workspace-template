import type postgres from "postgres";
import type { Actor } from "../../core/shared/actor.ts";
import type { EntityIssuerStore } from "../../core/entity-issuers/application.ts";
import type { EntityIssuer, EntityTypeIdentity, IdentifierRule } from "../../contracts/entity-issuer.ts";
import { APP_IDENTIFIER_RULE_ID } from "../../contracts/entity-issuer.ts";
import { AppError, notFound } from "../../core/shared/errors.ts";
import { runAsActor } from "./sql-context.ts";
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
  async issuerIsDefault(code: string) {
    const [row] = await this
      .tx`select exists(select 1 from app.entity_type_identity where default_source=${code}) as used`;
    return row.used as boolean;
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
  async ruleUsage(id: string) {
    const [row] = await this.tx`select
      exists(select 1 from app.entity_type_identity_sources where rule_id=${id}::uuid and referenced) as referenced,
      exists(select 1 from app.entity_type_identity i join app.entity_type_identity_sources s using(owner_id,type_id) where i.default_source=s.code and s.rule_id=${id}::uuid) as default_used`;
    return { referenced: row.referenced as boolean, usedAsDefault: row.default_used as boolean };
  }
  async lockTypeIdentity(typeId: string) {
    await this.lockOwner();
    const [row] = await this.tx`select * from app.entity_type_identity where type_id=${typeId}::uuid for update`;
    if (!row) return null;
    await this.tx`select code from app.entity_type_identity_sources where type_id=${typeId}::uuid for update`;
    return this.getTypeIdentity(typeId);
  }
  async identitySourceAvailability(sources: { code: string; rule_id: string }[]) {
    const rows = await this.tx`select i.code,r.id as rule_id,i.active as issuer_active,r.active as rule_active
      from app.entity_issuers i join app.entity_identifier_rules r on r.owner_id=i.owner_id and r.source=i.code
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
      .tx`insert into app.entity_issuers(owner_id,code,label) values(${this.actor.userId},${input.code},${input.label}) returning *`;
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
      .tx`insert into app.entity_identifier_rules(owner_id,source,label,meaning,generation) values(${this.actor.userId},${source},${input.label},${input.meaning},'direct') returning *`;
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
      .tx`select s.code,s.rule_id,s.referenced,(s.active and i.active and r.active) as active,i.label as source_label,r.label as rule_label,r.generation from app.entity_type_identity_sources s join app.entity_issuers i on i.owner_id=s.owner_id and i.code=s.code join app.entity_identifier_rules r on r.owner_id=s.owner_id and r.id=s.rule_id where s.type_id=${r.type_id} order by s.code`;
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
    await this.tx`select pg_advisory_xact_lock(hashtextextended(${this.actor.userId + ":entity-identity-registry"},0))`;
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
        .tx`insert into app.entity_type_identity_sources(owner_id,type_id,code,rule_id,active) values(${this.actor.userId},${typeId}::uuid,${s.code},${s.rule_id},${s.active}) on conflict(owner_id,type_id,code) do update set rule_id=excluded.rule_id,active=excluded.active`;
    }
    const [saved] = await this
      .tx`update app.entity_type_identity set label=${input.label},default_source=${input.default_source},version=version+1 where type_id=${typeId}::uuid and version=${input.expected_version} returning type_id`;
    if (!saved) throw new AppError("settings_changed", "설정이 변경되었습니다. 최신 버전을 확인하세요");
    return (await this.getTypeIdentity(typeId))!;
  }
  async initializeTypeIdentity(typeId: string) {
    await this.lockOwner();
    await this
      .tx`insert into app.entity_issuers(owner_id,code,label,system) values(${this.actor.userId},'app','앱',true) on conflict do nothing`;
    await this
      .tx`insert into app.entity_identifier_rules(owner_id,id,source,label,meaning,generation) values(${this.actor.userId},${APP_IDENTIFIER_RULE_ID},'app','자동 발급','앱이 발급한 자료 번호','automatic') on conflict do nothing`;
    await this
      .tx`insert into app.entity_type_identity(owner_id,type_id,label,default_source) values(${this.actor.userId},${typeId},'번호','app')`;
    await this
      .tx`insert into app.entity_type_identity_sources(owner_id,type_id,code,rule_id) values(${this.actor.userId},${typeId},'app',${APP_IDENTIFIER_RULE_ID})`;
  }
}
export class SqlEntityIssuerUnitOfWork {
  constructor(private readonly sql: postgres.Sql) {}
  run<T>(actor: Actor, fn: (s: EntityIssuerStore) => Promise<T>): Promise<T> {
    return runAsActor(this.sql, actor, (tx) => fn(new SqlEntityIssuerStore(tx, actor)));
  }
}

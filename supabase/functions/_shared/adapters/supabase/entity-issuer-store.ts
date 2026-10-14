import type postgres from "postgres";
import type { Actor } from "../../core/shared/actor.ts";
import type { EntityIssuerStore } from "../../core/entity-issuers/application.ts";
import type { EntityIssuer, EntityTypeIdentity, IdentifierRule } from "../../contracts/entity-issuer.ts";
import { APP_IDENTIFIER_RULE_ID } from "../../contracts/entity-issuer.ts";
import { AppError, invalidInput, notFound } from "../../core/shared/errors.ts";
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
function version(current: postgres.Row, expected: number) {
  if (Number(current.version) !== expected) {
    throw new AppError("settings_changed", "설정이 변경되었습니다. 최신 버전을 확인하세요");
  }
}
export class SqlEntityIssuerStore implements EntityIssuerStore {
  constructor(private readonly tx: postgres.TransactionSql, private readonly actor: Actor) {}
  executeRequest<T>(request: RequestIdentity, execute: () => Promise<T>) {
    return executeSqlRequest(this.tx, this.actor, request, execute);
  }
  async listIssuers() {
    return (await this.tx`select * from app.entity_issuers order by code`).map(issuer);
  }
  async createIssuer(input: Parameters<EntityIssuerStore["createIssuer"]>[0]) {
    if (input.code === "app") throw invalidInput("앱 발급처는 시스템이 관리합니다");
    await this.lockOwner();
    const [n] = await this.tx`select count(*)::int as count from app.entity_issuers`;
    if (n.count >= 64) throw invalidInput("발급처는 64개까지 만들 수 있습니다");
    const [r] = await this
      .tx`insert into app.entity_issuers(owner_id,code,label) values(${this.actor.userId},${input.code},${input.label}) returning *`;
    return issuer(r);
  }
  async updateIssuer(code: string, input: Parameters<EntityIssuerStore["updateIssuer"]>[1]) {
    await this.lockOwner();
    const [r] = await this.tx`select * from app.entity_issuers where code=${code} for update`;
    if (!r) throw notFound();
    version(r, input.expected_version);
    if (r.system && input.active === false) throw invalidInput("앱 발급처는 중지할 수 없습니다");
    if (input.active === false) {
      const [used] = await this.tx`select 1 from app.entity_type_identity where default_source=${code} limit 1`;
      if (used) throw new AppError("conflict", "기본 발급처를 먼저 변경하세요");
    }
    const [saved] = await this.tx`update app.entity_issuers set label=${input.label ?? r.label},active=${
      input.active ?? r.active
    },version=version+1 where code=${code} returning *`;
    return issuer(saved);
  }
  async listRules(source: string) {
    const [r] = await this.tx`select 1 from app.entity_issuers where code=${source}`;
    if (!r) throw notFound();
    return (await this.tx`select * from app.entity_identifier_rules where source=${source} order by id`).map(rule);
  }
  async createRule(source: string, input: Parameters<EntityIssuerStore["createRule"]>[1]) {
    await this.lockOwner();
    const [s] = await this.tx`select * from app.entity_issuers where code=${source} for update`;
    if (!s) throw notFound();
    if (s.system) throw invalidInput("앱 규칙은 시스템이 관리합니다");
    const [n] = await this.tx`select count(*)::int as count from app.entity_identifier_rules where source=${source}`;
    if (n.count >= 64) throw invalidInput("발급처별 규칙은 64개까지 만들 수 있습니다");
    const [r] = await this
      .tx`insert into app.entity_identifier_rules(owner_id,source,label,meaning,generation) values(${this.actor.userId},${source},${input.label},${input.meaning},'direct') returning *`;
    return rule(r);
  }
  async updateRule(id: string, input: Parameters<EntityIssuerStore["updateRule"]>[1]) {
    await this.lockOwner();
    const [r] = await this.tx`select * from app.entity_identifier_rules where id=${id}::uuid for update`;
    if (!r) throw notFound();
    version(r, input.expected_version);
    if (r.source === "app" && (input.meaning !== undefined || input.active === false)) {
      throw invalidInput("앱 발급 규칙은 변경할 수 없습니다");
    }
    if (input.meaning !== undefined && input.meaning !== r.meaning) {
      const [used] = await this
        .tx`select 1 from app.entity_type_identity_sources where rule_id=${r.id} and referenced limit 1`;
      if (used) throw invalidInput("참조된 규칙의 번호 의미는 변경할 수 없습니다");
    }
    if (input.active === false) {
      const [used] = await this
        .tx`select 1 from app.entity_type_identity i join app.entity_type_identity_sources s using(owner_id,type_id) where i.default_source=s.code and s.rule_id=${r.id} limit 1`;
      if (used) throw new AppError("conflict", "기본 발급 규칙을 먼저 변경하세요");
    }
    const [saved] = await this.tx`update app.entity_identifier_rules set label=${input.label ?? r.label},meaning=${
      input.meaning ?? r.meaning
    },active=${input.active ?? r.active},version=version+1 where id=${r.id} returning *`;
    return rule(saved);
  }
  async getTypeIdentity(typeId: string, lock = false): Promise<EntityTypeIdentity | null> {
    if (lock) await this.lockOwner();
    const rows = lock
      ? await this.tx`select * from app.entity_type_identity where type_id=${typeId}::uuid for share`
      : await this.tx`select * from app.entity_type_identity where type_id=${typeId}::uuid`;
    const r = rows[0];
    if (!r) return null;
    const sources = await this
      .tx`select s.code,s.rule_id,(s.active and i.active and r.active) as active,i.label as source_label,r.label as rule_label,r.generation from app.entity_type_identity_sources s join app.entity_issuers i on i.owner_id=s.owner_id and i.code=s.code join app.entity_identifier_rules r on r.owner_id=s.owner_id and r.id=s.rule_id where s.type_id=${r.type_id} order by s.code`;
    return {
      type_id: r.type_id,
      label: r.label,
      default_source: r.default_source,
      version: Number(r.version),
      sources: sources.map((s) => ({
        code: s.code,
        rule_id: s.rule_id,
        active: s.active,
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
    await this.lockOwner();
    const [r] = await this.tx`select * from app.entity_type_identity where type_id=${typeId}::uuid for update`;
    if (!r) throw notFound();
    version(r, input.expected_version);
    const old = await this.tx`select * from app.entity_type_identity_sources where type_id=${r.type_id} for update`;
    for (const s of old) {
      const next = input.sources.find((n) => n.code === s.code);
      if (s.referenced && (!next || next.rule_id.toLowerCase() !== s.rule_id)) {
        throw invalidInput("참조된 발급처 규칙은 제거하거나 교체할 수 없습니다");
      }
    }
    for (const s of input.sources) {
      const [allowed] = await this
        .tx`select i.active as issuer_active,r.active as rule_active from app.entity_issuers i join app.entity_identifier_rules r on r.owner_id=i.owner_id and r.source=i.code where i.code=${s.code} and r.id=${s.rule_id}`;
      if (!allowed) throw new AppError("invalid_reference", "발급처와 규칙을 확인하세요");
      if (s.active && (!allowed.issuer_active || !allowed.rule_active)) {
        throw invalidInput("중지된 발급처·규칙을 활성 연결할 수 없습니다");
      }
    }
    for (const s of old) {
      if (!input.sources.some((n) => n.code === s.code)) {
        await this.tx`delete from app.entity_type_identity_sources where type_id=${r.type_id} and code=${s.code}`;
      }
    }
    for (const s of input.sources) {
      await this
        .tx`insert into app.entity_type_identity_sources(owner_id,type_id,code,rule_id,active) values(${this.actor.userId},${r.type_id},${s.code},${s.rule_id},${s.active}) on conflict(owner_id,type_id,code) do update set rule_id=excluded.rule_id,active=excluded.active`;
    }
    await this
      .tx`update app.entity_type_identity set label=${input.label},default_source=${input.default_source},version=version+1 where type_id=${r.type_id}`;
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

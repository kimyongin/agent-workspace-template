import type {
  SchemaApplicationBindings,
  SchemaApplicationContext,
} from "../../core/entity-types/schema-application.ts";
import { assertRecoveryFresh, type RecoveryEvidence } from "../../core/entity-types/recovery-policy.ts";
import {
  assertSchemaTemplateReferences,
  effectiveEntityTemplateFingerprint,
} from "../../core/entity-types/template-references.ts";
import type { RecordTemplates } from "../../contracts/record-template.ts";
import type postgres from "postgres";
import type { Actor } from "../../core/shared/actor.ts";
import type { SchemaChangeStore } from "../../core/entity-types/schema-changes.ts";
import type {
  EntitySchemaChange,
  EntitySchemaChangeSummary,
  SchemaAnalysis,
  SchemaAnalysisPage,
  SchemaDefinition,
  SchemaEdit,
} from "../../contracts/entity-schema-change.ts";
import { compileMigration } from "../../core/entity-types/conversions.ts";
import { AppError, conflict, invalidInput, notFound } from "../../core/shared/errors.ts";
import { jsonbText } from "../../core/entity-types/schema-rules.ts";
import { canonical, definitionFingerprint, resolveSchemaEdits } from "../../core/entity-types/evolution.ts";
export class SqlSchemaChangeStore implements SchemaChangeStore {
  constructor(protected readonly tx: postgres.TransactionSql, protected readonly actor: Actor) {}
  protected async lockType(typeId: string) {
    const [t] = await this.tx`select * from app.entity_types where id::text=${typeId} for update`;
    if (!t) throw notFound();
    if (t.schema_write_locked) {
      throw new AppError("schema_migration_in_progress", "마이그레이션 완료 후 다시 시도하세요");
    }
    return t;
  }
  protected sourceRefs(t: postgres.Row, i: { expected_type_version: number; expected_schema_version: number }) {
    if (t.version !== i.expected_type_version || t.schema_version !== i.expected_schema_version) {
      throw new AppError("schema_changed", "자료 종류나 속성 정의가 변경되었습니다", undefined, {
        type_id: t.id,
        type_version: Number(t.version),
        schema_version: Number(t.schema_version),
      });
    }
    if (t.archived) throw new AppError("entity_type_archived", "보관된 자료 종류를 먼저 복원하세요");
  }
  protected async definition(t: postgres.Row): Promise<SchemaDefinition> {
    const [v] = await this
      .tx`select schema,display from app.entity_schema_versions where type_id=${t.id} and schema_version=${t.schema_version}`;
    return { schema: v.schema, display: v.display };
  }
  protected async templates(target: SchemaDefinition, typeId: string, expected?: string) {
    await this.tx`select pg_advisory_xact_lock(hashtextextended(${`${this.actor.userId}:record_templates`},0))`;
    const [row] = await this.tx`select version,settings from app.user_business_settings where id='record_templates'`;
    const version = await effectiveEntityTemplateFingerprint(row?.settings as RecordTemplates | undefined, typeId);
    if (expected !== undefined && version !== expected) {
      throw new AppError("schema_plan_stale", "기록 템플릿이 변경되었습니다. 새 변경과 분석을 준비하세요");
    }
    assertSchemaTemplateReferences(target, (row?.settings ?? {}) as RecordTemplates, typeId);
    return version;
  }
  private async migrationOwnership(typeId: string, input: Parameters<SchemaChangeStore["createChange"]>[1]) {
    for (const rule of input.migration.rules) {
      if (rule.op === "remove" && !input.edits.some((e) => e.op === "remove_property" && e.key === rule.key)) {
        throw invalidInput("속성 제거 편집과 같은 키의 명시 제거만 지원합니다");
      }
    }
    const ids = [...new Set(input.migration.overrides.map((o) => o.entity_id))];
    if (ids.length) {
      const [r] = await this
        .tx`select count(*)::int as count from app.entities where entity_type_id=${typeId} and id=any(${ids}::text[])`;
      if (r.count !== ids.length) throw notFound();
    }
  }
  private async reserve(t: postgres.Row, edits: SchemaEdit[], prior: Record<string, string> = {}) {
    const reservations: Record<string, string> = Object.assign(Object.create(null), prior);
    let next = Number(t.next_property_number);
    const refs = new Set<string>();
    for (const edit of edits) {
      if (edit.op === "add_property") {
        if (refs.has(edit.client_ref)) throw invalidInput("추가 참조는 중복될 수 없습니다");
        refs.add(edit.client_ref);
        if (!Object.hasOwn(reservations, edit.client_ref)) reservations[edit.client_ref] = `prop_${next++}`;
      }
    }
    if (next !== Number(t.next_property_number)) {
      await this.tx`update app.entity_types set next_property_number=${next} where id=${t.id}`;
    }
    return reservations;
  }
  protected async recoveryConflicts(j: postgres.Row, typeId: string, referencesChanged: boolean) {
    const rows = await this
      .tx`select coalesce(e.id,r.entity_id) as id from app.entities e full join private.entity_schema_migration_rows r on r.owner_id=e.owner_id and r.entity_id=e.id and r.job_id=${j.id} where (e.entity_type_id=${typeId} or r.job_id=${j.id}) and (e.id is null or r.entity_id is null or e.version<>r.committed_version or e.deleted_at is distinct from r.source_deleted_at) order by coalesce(e.id,r.entity_id) limit 20`;
    return [
      ...rows.map((r) => ({
        path: `entities.${r.id}`,
        message: "완료 후 값·태그·자료 상태·식별 또는 연결이 변경되어 자동 복구하지 않습니다",
      })),
      ...(referencesChanged ? [{ path: "references", message: "연결 또는 할 일·기록의 선택이 변경되었습니다" }] : []),
    ];
  }
  protected async recoveryEvidence(j: postgres.Row, t: postgres.Row) {
    const [material] = await this
      .tx`select count(*)::int as count from private.entity_schema_migration_rows where job_id=${j.id}`;
    const present = !!(j.source_definition?.schema && j.committed_membership && j.committed_references);
    const [fresh] = present
      ? await this
        .tx`select app.entity_schema_membership(${this.actor.userId},${t.id})=${j.committed_membership} as values, app.entity_schema_reference_baseline(${this.actor.userId},${t.id})=${
        this.tx.json(j.committed_references)
      }::jsonb as references`
      : [{ values: false, references: false }];
    const evidence: RecoveryEvidence = {
      status: j.status,
      expires_at: j.source_expires_at?.toISOString() ?? null,
      material_present: present,
      retained: Number(material.count),
      total: Number(j.total),
      values_match: fresh.values,
      references_match: fresh.references,
      conflicts: present && (!fresh.values || !fresh.references)
        ? await this.recoveryConflicts(j, t.id, !fresh.references)
        : [],
      type: {
        id: t.id,
        version: Number(t.version),
        schema_version: Number(t.schema_version),
        archived: t.archived,
        schema_write_locked: t.schema_write_locked,
      },
    };
    return { evidence, observed_at: await this.recoveryObservedAt() };
  }
  async recoveryObservedAt() {
    const [time] = await this.tx`select clock_timestamp() as observed_at`;
    return time.observed_at.toISOString();
  }
  protected async recoveryFresh(c: postgres.Row, lock = true) {
    if (!c.recovery_source_job_id) return;
    const [j] = await this.tx`select * from app.entity_schema_migrations where id=${c.recovery_source_job_id} ${
      lock ? this.tx`for update` : this.tx``
    }`;
    if (!j) throw notFound();
    const [t] = await this.tx`select * from app.entity_types where id=${c.type_id}`;
    if (!t) throw notFound();
    const read = await this.recoveryEvidence(j, t);
    assertRecoveryFresh(read.evidence, new Date(read.observed_at));
  }
  protected async row(typeId: string, id: string, lock = false) {
    const [row] = await this
      .tx`select * from app.entity_schema_changes where type_id::text=${typeId} and id::text=${id} ${
      lock ? this.tx`for update` : this.tx``
    }`;
    if (!row) throw notFound();
    return row;
  }
  protected editable(row: postgres.Row, version: number) {
    if (Number(row.version) !== version) throw conflict("변경 초안 버전이 변경되었습니다");
    if (["applied", "cancelled"].includes(row.status)) throw conflict("완료된 변경은 수정할 수 없습니다");
  }
  protected async dto(row: postgres.Row): Promise<EntitySchemaChange> {
    let analysis: SchemaAnalysis | null = null;
    let status = row.status;
    if (row.analysis_id) {
      const [a] = await this.tx`select * from app.entity_schema_analyses where id=${row.analysis_id}`;
      if (a) {
        const errors = await this
          .tx`select entity_id,errors from private.entity_schema_analysis_rows where analysis_id=${a.id} and jsonb_array_length(errors)>0 order by entity_id limit 20`;
        analysis = {
          id: a.id,
          change_version: Number(a.change_version),
          status: a.status,
          total: Number(a.total),
          snapshot_fingerprint: a.membership,
          definition_fingerprint: a.fingerprint,
          processed: Number(a.processed),
          failed: Number(a.failed),
          changed: Number(a.changed ?? 0),
          unchanged: Number(a.unchanged ?? 0),
          removed: Number(a.removed ?? 0),
          replacements: Number(a.replacements ?? 0),
          retryable: Boolean(a.retryable),
          failure_reason: a.failure_reason ?? null,
          errors: errors.map((r) => ({ entity_id: r.entity_id, fields: r.errors })),
          created_at: a.created_at.toISOString(),
        };
      }
    }
    if (!["applied", "cancelled"].includes(status)) {
      const [fresh] = await this
        .tx`select version=${row.source_type_version} and schema_version=${row.source_schema_version} and (not schema_write_locked or exists(select 1 from app.entity_schema_migrations j where j.change_id=${row.id} and j.status in ('queued','preparing','ready_to_commit','committing'))) as fresh from app.entity_types where id=${row.type_id}`;
      if (!fresh?.fresh) status = "stale";
      const [settings] = await this.tx`select settings from app.user_business_settings where id='record_templates'`;
      if (
        await effectiveEntityTemplateFingerprint(settings?.settings, row.type_id) !== row.source_template_fingerprint
      ) status = "stale";
      if (analysis) {
        const [a] = await this
          .tx`select membership=app.entity_schema_membership(owner_id,type_id) as fresh from app.entity_schema_analyses where id=${row.analysis_id}`;
        if (!a?.fresh) status = "stale";
      }
    }
    return {
      id: row.id,
      type_id: row.type_id,
      source_type_version: Number(row.source_type_version),
      source_schema_version: Number(row.source_schema_version),
      source_template_fingerprint: row.source_template_fingerprint,
      version: Number(row.version),
      status,
      change_kind: row.kind,
      edits: row.edits,
      migration: row.migration ?? { rules: [], overrides: [] },
      recovery: row.recovery_source_job_id
        ? { source_job_id: row.recovery_source_job_id, source_expires_at: row.recovery_expires_at.toISOString() }
        : null,
      executable: status === "ready" && analysis?.status === "succeeded" && analysis.failed === 0,
      reservations: row.reservations,
      target: row.target,
      diff: row.diff,
      fingerprint: row.fingerprint,
      analysis,
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
    };
  }
  async createChange(typeId: string, input: Parameters<SchemaChangeStore["createChange"]>[1]) {
    const t = await this.lockType(typeId);
    this.sourceRefs(t, input);
    const reservations = await this.reserve(t, input.edits);
    const resolved = resolveSchemaEdits(await this.definition(t), input.edits, reservations);
    await this.migrationOwnership(typeId, input);
    compileMigration(resolved.target, input.migration);
    if (input.migration.rules.length || input.migration.overrides.length) resolved.kind = "migration_required";
    const templateVersion = await this.templates(resolved.target, typeId);
    const fingerprint = await definitionFingerprint({
      type_id: typeId,
      source_type_version: t.version,
      source_schema_version: t.schema_version,
      source_template_fingerprint: templateVersion,
      edits: input.edits,
      migration: input.migration,
      reservations,
      target: resolved.target,
    });
    const [r] = await this
      .tx`insert into app.entity_schema_changes(owner_id,type_id,source_type_version,source_schema_version,source_template_fingerprint,migration,edits,reservations,target,diff,kind,fingerprint) values(${this.actor.userId},${typeId},${t.version},${t.schema_version},${templateVersion},${
      this.tx.json(input.migration as never)
    },${this.tx.json(input.edits as never)},${this.tx.json(reservations)},${this.tx.json(resolved.target as never)},${
      this.tx.json(resolved.diff as never)
    },${resolved.kind},${fingerprint}) returning *`;
    return this.dto(r);
  }
  async updateChange(typeId: string, id: string, input: Parameters<SchemaChangeStore["updateChange"]>[2]) {
    const t = await this.lockType(typeId);
    this.sourceRefs(t, input);
    const row = await this.row(typeId, id, true);
    this.editable(row, input.expected_change_version);
    if (
      Number(row.source_type_version) !== input.expected_type_version ||
      Number(row.source_schema_version) !== input.expected_schema_version
    ) throw new AppError("schema_plan_stale", "새 정의를 기준으로 새 변경을 만드세요");
    if (row.recovery_source_job_id) {
      throw conflict("복구 초안은 원본에 결속됩니다. 현재 변경을 수동 보완한 후 새 복구안과 분석을 준비하세요");
    }
    const reservations = await this.reserve(t, input.edits, row.reservations);
    const resolved = resolveSchemaEdits(await this.definition(t), input.edits, reservations);
    await this.migrationOwnership(typeId, input);
    compileMigration(resolved.target, input.migration);
    if (input.migration.rules.length || input.migration.overrides.length) resolved.kind = "migration_required";
    await this.templates(resolved.target, typeId, row.source_template_fingerprint);
    if (canonical(input.edits) === canonical(row.edits) && canonical(input.migration) === canonical(row.migration)) {
      return this.dto(row);
    }
    const fingerprint = await definitionFingerprint({
      type_id: typeId,
      source_type_version: t.version,
      source_schema_version: t.schema_version,
      source_template_fingerprint: row.source_template_fingerprint,
      edits: input.edits,
      migration: input.migration,
      reservations,
      target: resolved.target,
    });
    const [r] = await this
      .tx`update app.entity_schema_changes set version=version+1,status='draft',analysis_id=null,migration=${
      this.tx.json(input.migration as never)
    },edits=${this.tx.json(input.edits as never)},reservations=${this.tx.json(reservations)},target=${
      this.tx.json(resolved.target as never)
    },diff=${
      this.tx.json(resolved.diff as never)
    },kind=${resolved.kind},fingerprint=${fingerprint},updated_at=now() where id=${id} returning *`;
    return this.dto(r);
  }
  async getChange(typeId: string, id: string) {
    return this.dto(await this.row(typeId, id));
  }
  async listChanges(typeId: string, input: Parameters<SchemaChangeStore["listChanges"]>[1]) {
    const [t] = await this.tx`select id from app.entity_types where id::text=${typeId}`;
    if (!t) throw notFound();
    const rows = await this.tx`select * from app.entity_schema_changes where type_id=${typeId} and (${
      input.before ?? null
    }::uuid is null or id<${input.before ?? null}::uuid) order by id desc limit ${input.limit + 1}`;
    return {
      items: rows.slice(0, input.limit).map((r): EntitySchemaChangeSummary => ({
        id: r.id,
        type_id: r.type_id,
        version: Number(r.version),
        status: r.status,
        change_kind: r.kind,
        created_at: r.created_at.toISOString(),
        updated_at: r.updated_at.toISOString(),
      })),
      next_before: rows.length > input.limit ? String(rows[input.limit - 1].id) : null,
    };
  }
  async analyzeChange(typeId: string, id: string, input: Parameters<SchemaChangeStore["analyzeChange"]>[2]) {
    const t = await this.lockType(typeId);
    const row = await this.row(typeId, id, true);
    this.editable(row, input.expected_change_version);
    this.sourceRefs(t, {
      expected_type_version: Number(row.source_type_version),
      expected_schema_version: Number(row.source_schema_version),
    });
    await this.recoveryFresh(row);
    await this.templates(row.target, typeId, row.source_template_fingerprint);
    const overrides = row.migration?.overrides ?? [];
    for (const override of overrides) {
      const [entity] = await this
        .tx`select id from app.entities where entity_type_id=${typeId} and id=${override.entity_id}`;
      if (!entity) throw notFound();
    }
    const [a] = await this
      .tx`with snapshot as materialized (select owner_id,id,version,schema_version,properties,deleted_at from app.entities where entity_type_id=${typeId}), size as (select count(*)::int as count,coalesce(sum(octet_length(jsonb_build_array(id,version,schema_version,properties,deleted_at)::text)),0)::bigint as bytes from snapshot), analysis as (insert into app.entity_schema_analyses(owner_id,type_id,change_id,change_version,fingerprint,membership,total) select ${this.actor.userId},${typeId},${id},${row.version},${row.fingerprint},md5(coalesce((select jsonb_agg(jsonb_build_array(id,version,schema_version,properties,deleted_at) order by id)::text from snapshot),'[]')),count from size where count<=2000 and bytes<=8388608 returning id), saved as (insert into private.entity_schema_analysis_rows(owner_id,analysis_id,entity_id,source_version,source_schema_version,properties,deleted_at) select s.owner_id,a.id,s.id,s.version,s.schema_version,s.properties,s.deleted_at from snapshot s cross join analysis a returning entity_id) select a.id,(select count(*) from saved) as captured from analysis a`;
    if (!a) throw invalidInput("영향 분석은 2000개·8 MiB 이하에서 실행할 수 있습니다");
    if (row.recovery_source_job_id) {
      await this
        .tx`update private.entity_schema_analysis_rows r set recovery_properties=s.source_properties from private.entity_schema_migration_rows s where r.analysis_id=${a.id} and s.job_id=${row.recovery_source_job_id} and s.entity_id=r.entity_id and s.owner_id=r.owner_id`;
      const [size] = await this
        .tx`select coalesce(sum(octet_length(properties::text)+octet_length(recovery_properties::text)),0) as bytes from private.entity_schema_analysis_rows where analysis_id=${a.id}`;
      if (Number(size.bytes) > 8388608) throw invalidInput("복구 분석 원본은 8 MiB 이하에서 실행할 수 있습니다");
    }
    await this
      .tx`update app.entity_schema_changes set status='analyzing',analysis_id=${a.id},updated_at=now() where id=${id}`;
    return {
      type_id: typeId,
      change_id: id,
      change_version: Number(row.version),
      analysis_id: String(a.id),
      status: "queued" as const,
    };
  }
  async analysisRows(
    typeId: string,
    id: string,
    input: Parameters<SchemaChangeStore["analysisRows"]>[2],
  ): Promise<SchemaAnalysisPage> {
    const change = await this.row(typeId, id);
    await this.recoveryFresh(change, false);
    const [expired] = await this
      .tx`select id from app.entity_schema_migrations where analysis_id=${input.analysis_id} and source_expires_at<=now() and status='succeeded'`;
    if (expired) throw new AppError("migration_source_expired", "원본 분석 자료의 30일 보관 기간이 지났습니다");
    if (change.analysis_id !== input.analysis_id) throw new AppError("schema_plan_stale", "최신 분석을 조회하세요");
    const [a] = await this
      .tx`select status from app.entity_schema_analyses where id=${input.analysis_id} and change_id=${id}`;
    if (!a) throw notFound();
    if (a.status !== "succeeded") throw conflict("분석이 아직 완료되지 않았습니다");
    const rows = await this
      .tx`select entity_id,properties as before,after,after_bytes,changed,removed,replacements,errors from private.entity_schema_analysis_rows where analysis_id=${input.analysis_id} and (${
      input.after ?? null
    }::text is null or entity_id>${
      input.after ?? null
    }) and (${input.failures_only}=false or jsonb_array_length(errors)>0) order by entity_id limit ${input.limit + 1}`;
    const items: SchemaAnalysisPage["items"] = [];
    let bytes = 0;
    for (const r of rows.slice(0, input.limit)) {
      const item = {
        entity_id: r.entity_id,
        before: r.before,
        after: r.after,
        after_bytes: Number(r.after_bytes),
        changed: r.changed,
        removed: Number(r.removed),
        replacements: Number(r.replacements),
        errors: r.errors,
      };
      const size = new TextEncoder().encode(jsonbText(item)).length;
      if (bytes + size > 524288) break;
      items.push(item);
      bytes += size;
    }
    return {
      analysis_id: input.analysis_id,
      items,
      next_after: rows.length > items.length && items.length ? items.at(-1)!.entity_id : null,
    };
  }
  async loadSchemaApplication(typeId: string, id: string, analysisId: string): Promise<SchemaApplicationContext> {
    const [t] = await this.tx`select * from app.entity_types where id::text=${typeId} for update`;
    if (!t) throw notFound();
    const c = await this.row(typeId, id, true);
    const [a] = await this
      .tx`select * from app.entity_schema_analyses where id::text=${analysisId} and change_id=${id}`;
    const [fresh] = await this.tx`select app.entity_schema_membership(${this.actor.userId},${typeId}) as membership`;
    return {
      type: {
        id: t.id,
        label: t.label,
        icon_id: t.icon_id,
        version: Number(t.version),
        schema_version: Number(t.schema_version),
        archived: t.archived,
        schema_write_locked: t.schema_write_locked,
      },
      change: {
        id: c.id,
        version: Number(c.version),
        status: c.status,
        kind: c.kind,
        source_type_version: Number(c.source_type_version),
        source_schema_version: Number(c.source_schema_version),
        analysis_id: c.analysis_id,
        fingerprint: c.fingerprint,
        source_template_fingerprint: c.source_template_fingerprint,
        target: c.target,
        diff: c.diff,
        migration: c.migration,
        recovery_source_job_id: c.recovery_source_job_id,
        recovery_keys: c.recovery_keys,
      },
      analysis: a
        ? {
          id: a.id,
          status: a.status,
          failed: Number(a.failed),
          change_version: Number(a.change_version),
          fingerprint: a.fingerprint,
          membership: a.membership,
          total: Number(a.total),
        }
        : null,
      membership: fresh.membership,
    };
  }
  async lockSchemaApplicationBindings(context: SchemaApplicationContext): Promise<SchemaApplicationBindings> {
    let recovery: SchemaApplicationBindings["recovery"] = null;
    if (context.change.recovery_source_job_id) {
      const [j] = await this
        .tx`select * from app.entity_schema_migrations where id=${context.change.recovery_source_job_id} for update`;
      if (!j) throw notFound();
      recovery = await this.recoveryEvidence(j, context.type);
    }
    await this.tx`select pg_advisory_xact_lock(hashtextextended(${`${this.actor.userId}:record_templates`},0))`;
    const [row] = await this.tx`select settings from app.user_business_settings where id='record_templates'`;
    if (recovery) recovery.observed_at = await this.recoveryObservedAt();
    return { recovery, templates: row?.settings ?? {} };
  }
  async saveSchemaPublication(context: SchemaApplicationContext, next: number) {
    const typeId = context.type.id, id = context.change.id, row = context.change;
    await this
      .tx`insert into app.entity_schema_versions(owner_id,type_id,schema_version,schema,display) values(${this.actor.userId},${typeId},${next},${
      this.tx.json(row.target.schema)
    },${this.tx.json(row.target.display)})`;
    await this
      .tx`update app.entity_types set schema_version=${next},version=version+1,updated_at=now() where id=${typeId}`;
    const [r] = await this
      .tx`update app.entity_schema_changes set status='applied',updated_at=now() where id=${id} returning *`;
    return this.dto(r);
  }
}

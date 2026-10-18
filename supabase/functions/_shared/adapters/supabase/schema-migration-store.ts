import { loadSchemaType } from "./schema-type.ts";
import { normalizeStoredEntityDefinition } from "../../core/entity-types/stored-definition.ts";
import { type SchemaApplicationContext } from "../../core/entity-types/schema-application.ts";
import { jsonbText } from "../../core/entity-types/schema-rules.ts";
import { migrationRecordRenderer } from "../../core/entity-types/migration-preparation.ts";
import {
  assessRecovery,
  type RecoveryContext,
  type RecoveryProposal,
} from "../../core/entity-types/recovery-policy.ts";
import type postgres from "postgres";
import { SqlSchemaChangeStore } from "./schema-change-store.ts";
import type { SchemaMigrationActionContext, SchemaMigrationStore } from "../../core/entity-types/schema-migrations.ts";
import type { EntitySchemaMigration, SchemaMigrationAccepted } from "../../contracts/entity-schema-migration.ts";
import { effectiveEntityTemplates } from "../../contracts/record-template.ts";
import { AppError, invalidInput, notFound } from "../../core/shared/errors.ts";
import { resolvedEntityTypeIcon } from "../../contracts/entity-type.ts";
export class SqlSchemaMigrationStore extends SqlSchemaChangeStore implements SchemaMigrationStore {
  private accepted(r: postgres.Row): SchemaMigrationAccepted {
    return {
      job_id: r.id,
      type_id: r.type_id,
      change_id: r.change_id,
      analysis_id: r.analysis_id,
      job_version: Number(r.version),
      status: "queued",
    };
  }
  private async job(id: string, lock = false) {
    const [r] = await this.tx`select * from app.entity_schema_migrations where id::text=${id} ${
      lock ? this.tx`for update` : this.tx``
    }`;
    if (!r) throw notFound();
    return r;
  }
  private async jobDto(r: postgres.Row): Promise<EntitySchemaMigration> {
    await this.authorizeSchemaKinds(r.required_kind_ids ?? [r.type_id], "read");
    const t = (await loadSchemaType(this.tx, r.type_id))!;
    return {
      id: r.id,
      type_id: r.type_id,
      type: { id: t.id, label: t.label, archived: t.archived, icon_id: resolvedEntityTypeIcon(t.icon_id) },
      change_id: r.change_id,
      change_version: Number(r.change_version),
      analysis_id: r.analysis_id,
      fingerprint: r.fingerprint,
      source_schema_version: Number(r.source_schema_version),
      version: Number(r.version),
      status: r.status,
      total: Number(r.total),
      processed: Number(r.processed),
      retryable: r.retryable,
      failure_reason: r.failure_reason,
      result: r.result
        ? {
          schema_version: Number(r.result.schema_version),
          total: Number(r.result.total),
          changed: Number(r.result.changed),
          committed_at: r.result.committed_at,
        }
        : null,
      recovery: await this.recoveryAvailability(r, t),
      source_expires_at: r.source_expires_at?.toISOString() ?? null,
      created_at: r.created_at.toISOString(),
      updated_at: r.updated_at.toISOString(),
    };
  }
  private async recoveryAvailability(j: postgres.Row, t: postgres.Row) {
    const read = await this.recoveryEvidence(j, t);
    return assessRecovery(read.evidence, new Date(read.observed_at));
  }
  async loadRecovery(id: string): Promise<RecoveryContext> {
    const identity = await this.job(id);
    await this.authorizeSchemaKinds(identity.required_kind_ids ?? [identity.type_id], "write");
    const t = await loadSchemaType(this.tx, identity.type_id, true);
    if (!t) throw notFound();
    const j = await this.job(id, true), read = await this.recoveryEvidence(j, t);
    return {
      job_id: j.id,
      job_version: Number(j.version),
      ...read,
      source: normalizeStoredEntityDefinition(j.source_definition, t.id, Number(j.source_schema_version)),
      committed_target: normalizeStoredEntityDefinition(j.target, t.id, Number(j.source_schema_version) + 1),
      current: await this.definition(t),
      committed_membership: j.committed_membership,
      committed_references: j.committed_references,
    };
  }
  recoveryTemplates(typeId: string, target: RecoveryContext["source"]) {
    return this.templates(target, typeId);
  }
  async saveRecovery(context: RecoveryContext, proposal: RecoveryProposal) {
    const t = context.evidence.type;
    const [c] = await this
      .tx`insert into app.entity_schema_changes(workspace_id,type_id,source_type_version,source_schema_version,source_template_fingerprint,migration,edits,reservations,target,diff,kind,fingerprint,recovery_source_job_id,recovery_expires_at,recovery_keys) select ${this.schemaWorkspaceId},${t.id},${t.version},${t.schema_version},${proposal.templates},'{"rules":[],"overrides":[]}','[]','{}',${
      this.tx.json(proposal.target)
    },${
      this.tx.json(proposal.diff as never)
    },'migration_required',${proposal.fingerprint},${context.job_id},${context.evidence.expires_at},${
      this.tx.json(proposal.keys)
    } where ${context.evidence.expires_at}::timestamptz>clock_timestamp() returning *`;
    if (!c) throw new AppError("migration_source_expired", "복구 원본의 30일 보관 기간이 지났습니다");
    return this.dto(c);
  }
  async saveSchemaMigration(context: SchemaApplicationContext) {
    const t = context.type, c = context.change, a = context.analysis!;
    await this.authorizeSchemaKinds([t.id], "write");
    const typeId = t.id, changeId = c.id;
    const [definition] = await this
      .tx`select schema from app.entity_schema_versions where type_id=${typeId} and schema_version=${t.schema_version}`;
    const [settings] = await this.tx`select settings from app.user_business_settings where id='record_templates'`;
    const templates = effectiveEntityTemplates(settings?.settings, typeId);
    for (const template of Object.values(templates.entity!)) template!.tag_ids = [...template!.tag_ids].sort();
    const [refs] = await this
      .tx`select app.entity_schema_reference_baseline(${this.schemaWorkspaceId},${typeId}) as value`;
    const [time] = await this.tx`select clock_timestamp() as observed_at`;
    const [size] = await this
      .tx`select coalesce(sum(octet_length(r.properties::text)+octet_length(r.after::text)+coalesce(octet_length(r.recovery_properties::text),0)+octet_length(jsonb_build_object('source',e.source,'external_id',e.external_id,'tag_ids',coalesce((select jsonb_agg(tag_id order by tag_id) from app.entity_tags where entity_id=e.id),'[]'::jsonb))::text)),0) as bytes from private.entity_schema_analysis_rows r join app.entities e on e.workspace_id=r.workspace_id and e.id=r.entity_id where r.analysis_id=${a.id} and r.processed and jsonb_array_length(r.errors)=0`;
    const [metadata] = await this.tx`select octet_length(${this.tx.json(definition)}::jsonb::text)+octet_length(${
      this.tx.json(c.target)
    }::jsonb::text)+octet_length(${this.tx.json(refs.value)}::jsonb::text)+octet_length(${
      this.tx.json(templates as never)
    }::jsonb::text)+octet_length(${this.tx.json(c.migration)}::jsonb::text) as bytes`;
    let totalBytes = Number(size.bytes) + Number(metadata.bytes);
    const assertBudget = () => {
      if (totalBytes > 8388608) throw invalidInput("생성될 기록과 원본을 포함한 원자적 값 변환 준비 한도를 넘었습니다");
    };
    assertBudget();
    const tags = await this.tx`select id from app.tags where scope='record'`;
    const renderRecord = migrationRecordRenderer({
      type_id: typeId,
      source_schema_version: Number(t.schema_version),
      target: c.target,
      source_definition: { schema: definition.schema },
      templates,
      available_tags: tags.map((tag) => String(tag.id)),
      type: { id: t.id, label: t.label, icon_id: resolvedEntityTypeIcon(t.icon_id), archived: t.archived },
    }, time.observed_at);
    const encoder = new TextEncoder();
    let after: string | null = null, preparedCount = 0;
    while (true) {
      const rows: postgres.Row[] = await this
        .tx`with candidates as (select r.entity_id,r.properties,r.after,r.recovery_properties,r.changed,e.source,e.external_id,coalesce((select jsonb_agg(tag_id order by tag_id) from app.entity_tags where entity_id=e.id),'[]'::jsonb) as tag_ids,octet_length(r.properties::text)+octet_length(r.after::text)+coalesce(octet_length(r.recovery_properties::text),0)+octet_length(jsonb_build_object('source',e.source,'external_id',e.external_id,'tag_ids',coalesce((select jsonb_agg(tag_id order by tag_id) from app.entity_tags where entity_id=e.id),'[]'::jsonb))::text) as bytes from private.entity_schema_analysis_rows r join app.entities e on e.workspace_id=r.workspace_id and e.id=r.entity_id where r.analysis_id=${a.id} and r.processed and jsonb_array_length(r.errors)=0 and (${after}::text is null or r.entity_id collate "C">${after}::text collate "C") order by r.entity_id collate "C" limit 50), bounded as (select *,sum(bytes) over (order by entity_id collate "C") as cumulative from candidates) select * from bounded where cumulative<=524288 order by entity_id collate "C"`;
      if (!rows.length) break;
      for (const row of rows) {
        const record = renderRecord({
          entity_id: String(row.entity_id),
          properties: row.properties,
          after: row.after,
          changed: Boolean(row.changed),
          source: String(row.source),
          external_id: String(row.external_id),
          tag_ids: row.tag_ids,
        });
        totalBytes += encoder.encode(record.record_body ?? "").length +
          encoder.encode(jsonbText(record.record_context)).length +
          encoder.encode(jsonbText(record.record_tags)).length;
        assertBudget();
        preparedCount++;
      }
      after = String(rows.at(-1)!.entity_id);
    }
    if (preparedCount !== Number(a.total)) {
      throw invalidInput("모든 자료의 기록을 준비할 수 없습니다. 새 분석을 준비하세요");
    }
    await this.recoveryFresh(c.recovery_source_job_id, typeId);
    const [j] = await this
      .tx`insert into app.entity_schema_migrations(workspace_id,type_id,change_id,change_version,analysis_id,fingerprint,membership,source_type_version,source_schema_version,source_template_fingerprint,source_templates,source_definition,target,migration,source_references,total,actor_source,model_change_id) select ${this.schemaWorkspaceId},${typeId},${changeId},${c.version},${a.id},${c.fingerprint},${a.membership},${t.version},${t.schema_version},${c.source_template_fingerprint},${
      this.tx.json(templates as never)
    },${this.tx.json(definition)},${this.tx.json(c.target)},${this.tx.json(c.migration)},${
      this.tx.json(refs.value)
    },${a.total},${this.actor.source ?? "http"},${
      this.modelChangeId ?? null
    }::uuid where ${c.recovery_source_job_id}::uuid is null or exists(select 1 from app.entity_schema_migrations source where source.id=${c.recovery_source_job_id} and source.source_expires_at>clock_timestamp()) returning *`;
    if (!j) throw new AppError("migration_source_expired", "복구 원본의 30일 보관 기간이 지났습니다");
    await this
      .tx`insert into private.entity_schema_migration_rows(workspace_id,job_id,entity_id,source_version,source_schema_version,source_properties,source_deleted_at,source_identity,after,changed) select r.workspace_id,${j.id},r.entity_id,r.source_version,r.source_schema_version,r.properties,r.deleted_at,jsonb_build_object('source',e.source,'external_id',e.external_id,'tag_ids',coalesce((select jsonb_agg(tag_id order by tag_id) from app.entity_tags where entity_id=e.id),'[]'::jsonb)),r.after,r.changed from private.entity_schema_analysis_rows r join app.entities e on e.workspace_id=r.workspace_id and e.id=r.entity_id where r.analysis_id=${a.id} and r.processed and jsonb_array_length(r.errors)=0`;
    if (c.recovery_source_job_id) {
      await this
        .tx`update app.entity_schema_migrations set recovery_source_job_id=${c.recovery_source_job_id},recovery_keys=${
        this.tx.json(c.recovery_keys)
      } where id=${j.id}`;
      await this
        .tx`update private.entity_schema_migration_rows r set recovery_properties=a.recovery_properties from private.entity_schema_analysis_rows a where r.job_id=${j.id} and a.analysis_id=${c.analysis_id} and a.entity_id=r.entity_id and a.workspace_id=r.workspace_id`;
    }
    await this.tx`update app.entity_types set schema_write_locked=true where id=${typeId}`;
    return this.accepted(j);
  }
  async getMigration(id: string) {
    return this.jobDto(await this.job(id));
  }
  async listMigrations(i: Parameters<SchemaMigrationStore["listMigrations"]>[0]) {
    if (i.type_id) {
      const [t] = await this.tx`select id from app.entity_types where id=${i.type_id}`;
      if (!t) throw notFound();
    }
    const prior = i.before ? await this.job(i.before) : null;
    if (prior && i.type_id && prior.type_id !== i.type_id) throw invalidInput("이 종류의 작업 목록 cursor가 아닙니다");
    const rows = await this.tx`select * from app.entity_schema_migrations where (${
      i.type_id ?? null
    }::uuid is null or type_id=${i.type_id ?? null}::uuid) ${
      prior ? this.tx`and (created_at,id)<(${prior.created_at},${prior.id}::uuid)` : this.tx``
    } order by created_at desc,id desc limit ${i.limit + 1}`;
    return {
      items: await Promise.all(rows.slice(0, i.limit).map((r) => this.jobDto(r))),
      next_before: rows.length > i.limit ? String(rows[i.limit - 1].id) : null,
    };
  }
  async loadMigrationAction(id: string): Promise<SchemaMigrationActionContext> {
    const identity = await this.job(id);
    await this.authorizeSchemaKinds(identity.required_kind_ids ?? [identity.type_id], "write");
    if (identity.model_change_id && identity.model_change_id !== this.modelChangeId) {
      throw invalidInput("전체 모델 소속 작업은 자료 모델에서 함께 처리하세요");
    }
    const [type] = await this
      .tx`select schema_write_locked from app.entity_types where id=${identity.type_id} for update`;
    if (!type) throw notFound();
    const j = await this.job(id, true);
    const observed_at = await this.recoveryObservedAt();
    return {
      job: {
        id: j.id,
        type_id: j.type_id,
        change_id: j.change_id,
        change_version: Number(j.change_version),
        analysis_id: j.analysis_id,
        fingerprint: j.fingerprint,
        version: Number(j.version),
        status: j.status,
        retryable: j.retryable,
        source_expires_at: j.source_expires_at?.toISOString() ?? null,
      },
      schema_write_locked: type.schema_write_locked,
      observed_at,
    };
  }
  async saveMigrationCancellation(j: SchemaMigrationActionContext["job"]) {
    const id = j.id;
    const [r] = await this
      .tx`update app.entity_schema_migrations set status='cancelled',version=version+1,fence=fence+1,lease_until=null,retryable=false,updated_at=now() where id=${id} returning *`;
    await this.tx`delete from private.entity_schema_migration_rows where job_id=${id}`;
    await this
      .tx`update app.entity_schema_changes set status='draft',analysis_id=null,updated_at=now() where id=${j.change_id} and analysis_id=${j.analysis_id} and status='ready'`;
    await this.tx`update app.entity_types set schema_write_locked=false where id=${j.type_id}`;
    return this.jobDto(r);
  }
  async migrationReferencesFresh(id: string) {
    const j = await this.job(id);
    const [refs] = await this.tx`select app.entity_schema_reference_baseline(${this.schemaWorkspaceId},${j.type_id})=${
      this.tx.json(j.source_references)
    }::jsonb as fresh`;
    return Boolean(refs.fresh);
  }
  async saveMigrationRetry(j: SchemaMigrationActionContext["job"]) {
    const id = j.id;
    const [r] = await this
      .tx`update app.entity_schema_migrations set status='queued',version=version+1,fence=fence+1,lease_until=null,retryable=false,failure_reason=null,updated_at=now() where id=${id} returning *`;
    await this.tx`update app.entity_types set schema_write_locked=true where id=${j.type_id}`;
    // Acceptance status describes durable resumption, regardless of a worker's next internal phase.
    return this.accepted(r);
  }
}

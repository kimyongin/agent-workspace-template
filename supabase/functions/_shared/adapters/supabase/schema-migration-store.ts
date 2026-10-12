import type postgres from "postgres";
import { SqlSchemaChangeStore } from "./schema-change-store.ts";
import type { SchemaMigrationStore } from "../../core/entity-types/schema-migrations.ts";
import type { EntitySchemaMigration, SchemaMigrationAccepted } from "../../contracts/entity-schema-migration.ts";
import { effectiveEntityTemplates } from "../../contracts/record-template.ts";
import { AppError, conflict, invalidInput, notFound } from "../../core/shared/errors.ts";
import { definitionFingerprint } from "../../core/entity-types/evolution.ts";
import { validateEntityDefinition } from "../../core/entity-types/schema-rules.ts";
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
    const [t] = await this
      .tx`select id,label,icon_id,archived,version,schema_version from app.entity_types where id=${r.type_id}`;
    return {
      id: r.id,
      type_id: r.type_id,
      type: { id: t.id, label: t.label, archived: t.archived, icon_id: resolvedEntityTypeIcon(t.icon_id) },
      change_id: r.change_id,
      change_version: Number(r.change_version),
      analysis_id: r.analysis_id,
      fingerprint: r.fingerprint,
      source_type_version: Number(r.source_type_version),
      source_schema_version: Number(r.source_schema_version),
      version: Number(r.version),
      status: r.status,
      total: Number(r.total),
      processed: Number(r.processed),
      retryable: r.retryable,
      failure_reason: r.failure_reason,
      result: r.result,
      recovery: await this.recoveryAvailability(r, t),
      source_expires_at: r.source_expires_at?.toISOString() ?? null,
      created_at: r.created_at.toISOString(),
      updated_at: r.updated_at.toISOString(),
    };
  }
  private async recoveryAvailability(j: postgres.Row, t: postgres.Row) {
    let status: "available" | "expired" | "unavailable" | "conflict" = "available", reason: string | null = null;
    if (j.status !== "succeeded") {
      status = "unavailable";
      reason = "성공한 작업에서만 복구안을 만들 수 있습니다";
    } else if (j.source_expires_at <= new Date()) {
      status = "expired";
      reason = "복구 원본의 30일 보관 기간이 지났습니다";
    } else if (!j.source_definition?.schema || !j.committed_membership || !j.committed_references) {
      status = "unavailable";
      reason = "복구 원본 또는 확정 기준 자료가 없습니다";
    } else {
      const [r] = await this
        .tx`select count(*) as count from private.entity_schema_migration_rows where job_id=${j.id}`;
      if (Number(r.count) !== Number(j.total)) {
        status = "unavailable";
        reason = "복구 원본 자료가 없습니다";
      } else {
        const [b] = await this
          .tx`select app.entity_schema_membership(${this.actor.userId},${t.id})=${j.committed_membership} as values, app.entity_schema_reference_baseline(${this.actor.userId},${t.id})=${
          this.tx.json(j.committed_references)
        }::jsonb as references`;
        if (!b.values || !b.references || t.archived) {
          status = "conflict";
          reason = t.archived
            ? "보관된 자료 종류를 먼저 복원하세요"
            : "완료 후 값·자료 구성·연결 선택이 변경되었습니다. 수동 보완과 새 분석이 필요합니다";
        }
      }
    }
    return {
      status,
      reason,
      current_type_version: Number(t.version),
      current_schema_version: Number(t.schema_version),
    };
  }
  async createRecovery(id: string, i: Parameters<SchemaMigrationStore["createRecovery"]>[1]) {
    const identity = await this.job(id), t = await this.lockType(identity.type_id), j = await this.job(id, true);
    this.sourceRefs(t, i);
    if (j.version !== i.expected_job_version) throw conflict("작업 버전이 변경되었습니다. 다시 조회하세요");
    const available = await this.recoveryAvailability(j, t);
    if (available.status === "expired") throw new AppError("migration_source_expired", available.reason!);
    if (available.status === "unavailable") throw conflict(available.reason!);
    await this.recoveryFresh({ recovery_source_job_id: j.id, type_id: t.id });
    const current = await this.definition(t), target = structuredClone(j.source_definition);
    // Current-only fields and their display bindings survive subsequent compatible schema edits.
    for (const [key, field] of Object.entries(current.schema.properties)) {
      if (!Object.hasOwn(target.schema.properties, key) && !Object.hasOwn(j.target.schema.properties, key)) {
        target.schema.properties[key] = field;
        if (current.schema.required.includes(key)) target.schema.required.push(key);
        for (const name of ["order", "list_columns", "archived"] as const) {
          if (current.display[name].includes(key)) target.display[name].push(key);
        }
        if (current.display.option_labels[key]) target.display.option_labels[key] = current.display.option_labels[key];
      }
    }
    validateEntityDefinition(target);
    const templates = await this.templates(target, t.id);
    const diff = [{
      path: "recovery",
      before: current,
      after: target,
      before_present: true,
      after_present: true,
      kind: "migration_required",
      reason: "보존된 원본과 현재 속성을 검증하는 새 복구 버전",
      next_action: "분석·미리보기 후 값 변환 작업을 실행하세요",
    }];
    const fingerprint = await definitionFingerprint({
      source_job_id: j.id,
      source_type_version: t.version,
      source_schema_version: t.schema_version,
      target,
      templates,
      committed_membership: j.committed_membership,
      committed_references: j.committed_references,
    });
    const [c] = await this
      .tx`insert into app.entity_schema_changes(owner_id,type_id,source_type_version,source_schema_version,source_template_fingerprint,migration,edits,reservations,target,diff,kind,fingerprint,recovery_source_job_id,recovery_expires_at,recovery_keys) values(${this.actor.userId},${t.id},${t.version},${t.schema_version},${templates},'{"rules":[],"overrides":[]}','[]','{}',${
      this.tx.json(target)
    },${this.tx.json(diff)},'migration_required',${fingerprint},${j.id},${j.source_expires_at},${
      this.tx.json([
        ...new Set([...Object.keys(j.source_definition.schema.properties), ...Object.keys(j.target.schema.properties)]),
      ])
    }) returning *`;
    return this.dto(c);
  }
  private async validSource(t: postgres.Row, c: postgres.Row, analysisId: string) {
    this.sourceRefs(t, {
      expected_type_version: Number(c.source_type_version),
      expected_schema_version: Number(c.source_schema_version),
    });
    const [a] = await this.tx`select * from app.entity_schema_analyses where id=${analysisId} and change_id=${c.id}`;
    const [fresh] = await this.tx`select app.entity_schema_membership(${this.actor.userId},${t.id}) as membership`;
    if (c.kind !== "migration_required") throw invalidInput("호환 가능한 변경은 새 버전 게시를 사용하세요");
    if (
      c.status !== "ready" || c.analysis_id !== analysisId || !a || a.status !== "succeeded" || a.failed !== 0 ||
      a.change_version !== c.version || a.fingerprint !== c.fingerprint || a.membership !== fresh.membership
    ) throw new AppError("schema_plan_stale", "최신 성공 분석을 준비하세요");
    await this.recoveryFresh(c);
    await this.templates(c.target, t.id, c.source_template_fingerprint);
    return a;
  }
  async startMigration(typeId: string, changeId: string, i: Parameters<SchemaMigrationStore["startMigration"]>[2]) {
    const t = await this.lockType(typeId), c = await this.row(typeId, changeId, true);
    this.editable(c, i.expected_change_version);
    this.sourceRefs(t, i);
    if (c.fingerprint !== i.fingerprint) {
      throw new AppError("schema_plan_stale", "확인한 변경안과 실행 요청이 다릅니다");
    }
    const a = await this.validSource(t, c, i.analysis_id);
    const [definition] = await this
      .tx`select schema,display from app.entity_schema_versions where type_id=${typeId} and schema_version=${t.schema_version}`;
    const [settings] = await this.tx`select settings from app.user_business_settings where id='record_templates'`;
    const templates = effectiveEntityTemplates(settings?.settings, typeId);
    for (const template of Object.values(templates.entity!)) template!.tag_ids = [...template!.tag_ids].sort();
    const [refs] = await this.tx`select app.entity_schema_reference_baseline(${this.actor.userId},${typeId}) as value`;
    const [size] = await this
      .tx`select coalesce(sum(octet_length(properties::text)+octet_length(after::text)+coalesce(octet_length(recovery_properties::text),0)),0)::bigint as bytes from private.entity_schema_analysis_rows where analysis_id=${a.id}`;
    const metadataBytes = new TextEncoder().encode(
      JSON.stringify({ definition, target: c.target, references: refs.value, templates, migration: c.migration }),
    )
      .length;
    if (Number(size.bytes) + metadataBytes > 8388608) {
      throw invalidInput("원본·변환값·복구 문맥은 8 MiB 이하에서 실행할 수 있습니다");
    }
    const [j] = await this
      .tx`insert into app.entity_schema_migrations(owner_id,type_id,change_id,change_version,analysis_id,fingerprint,membership,source_type_version,source_schema_version,source_template_fingerprint,source_templates,source_definition,target,migration,source_references,total,actor_source) values(${this.actor.userId},${typeId},${changeId},${c.version},${a.id},${c.fingerprint},${a.membership},${t.version},${t.schema_version},${c.source_template_fingerprint},${
      this.tx.json(templates as never)
    },${this.tx.json(definition)},${this.tx.json(c.target)},${this.tx.json(c.migration)},${
      this.tx.json(refs.value)
    },${a.total},${this.actor.source ?? "http"}) returning *`;
    await this
      .tx`insert into private.entity_schema_migration_rows(owner_id,job_id,entity_id,source_version,source_schema_version,source_properties,source_deleted_at,source_identity,after,changed) select r.owner_id,${j.id},r.entity_id,r.source_version,r.source_schema_version,r.properties,r.deleted_at,jsonb_build_object('source',e.source,'external_id',e.external_id,'tag_ids',coalesce((select jsonb_agg(tag_id order by tag_id) from app.entity_tags where entity_id=e.id),'[]'::jsonb)),r.after,r.changed from private.entity_schema_analysis_rows r join app.entities e on e.owner_id=r.owner_id and e.id=r.entity_id where r.analysis_id=${a.id} and r.processed and jsonb_array_length(r.errors)=0`;
    if (c.recovery_source_job_id) {
      await this
        .tx`update app.entity_schema_migrations set recovery_source_job_id=${c.recovery_source_job_id},recovery_keys=${
        this.tx.json(c.recovery_keys)
      } where id=${j.id}`;
      await this
        .tx`update private.entity_schema_migration_rows r set recovery_properties=a.recovery_properties from private.entity_schema_analysis_rows a where r.job_id=${j.id} and a.analysis_id=${c.analysis_id} and a.entity_id=r.entity_id and a.owner_id=r.owner_id`;
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
  async cancelMigration(id: string, i: Parameters<SchemaMigrationStore["cancelMigration"]>[1]) {
    const identity = await this.job(id);
    await this.tx`select id from app.entity_types where id=${identity.type_id} for update`;
    const j = await this.job(id, true);
    // Terminal results always win even when a caller's version predates the commit.
    if (["committing", "succeeded", "failed", "cancelled"].includes(j.status)) return this.jobDto(j);
    if (j.version !== i.expected_job_version) throw conflict("작업 상태가 변경되었습니다. 다시 조회하세요");
    const [r] = await this
      .tx`update app.entity_schema_migrations set status='cancelled',version=version+1,fence=fence+1,lease_until=null,retryable=false,updated_at=now() where id=${id} returning *`;
    await this.tx`delete from private.entity_schema_migration_rows where job_id=${id}`;
    await this
      .tx`update app.entity_schema_changes set status='draft',analysis_id=null,updated_at=now() where id=${j.change_id} and analysis_id=${j.analysis_id} and status='ready'`;
    await this.tx`update app.entity_types set schema_write_locked=false where id=${j.type_id}`;
    return this.jobDto(r);
  }
  async retryMigration(id: string, i: Parameters<SchemaMigrationStore["retryMigration"]>[1]) {
    const identity = await this.job(id), t = await this.lockType(identity.type_id), j = await this.job(id, true);
    if (j.version !== i.expected_job_version) throw conflict("작업 상태가 변경되었습니다. 다시 조회하세요");
    if (j.source_expires_at && j.source_expires_at <= new Date()) {
      throw new AppError("migration_source_expired", "재시도 원본의 30일 보관 기간이 지났습니다. 새 분석을 준비하세요");
    }
    if (j.status !== "failed" || !j.retryable) {
      throw conflict("재시도 가능한 실패 작업만 재개할 수 있습니다. 새 분석을 준비하세요");
    }
    const c = await this.row(j.type_id, j.change_id, true);
    if (c.version !== j.change_version || c.fingerprint !== j.fingerprint || c.analysis_id !== j.analysis_id) {
      throw new AppError("schema_plan_stale", "새 분석을 준비하세요");
    }
    await this.validSource(t, c, j.analysis_id);
    const [refs] = await this.tx`select app.entity_schema_reference_baseline(${this.actor.userId},${j.type_id})=${
      this.tx.json(j.source_references)
    }::jsonb as fresh`;
    if (!refs.fresh) throw new AppError("schema_plan_stale", "연결이 변경되었습니다. 새 분석을 준비하세요");
    const [r] = await this
      .tx`update app.entity_schema_migrations set status='queued',version=version+1,fence=fence+1,lease_until=null,retryable=false,failure_reason=null,updated_at=now() where id=${id} returning *`;
    await this.tx`update app.entity_types set schema_write_locked=true where id=${j.type_id}`;
    // Acceptance status describes durable resumption, regardless of a worker's next internal phase.
    return this.accepted(r);
  }
}

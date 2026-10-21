import { normalizeStoredEntityDefinition } from "../../core/entity-types/stored-definition.ts";
import { authorizeWorkspace, requireWorkspaceActor } from "./workspace-context.ts";
import type { WorkspaceRequirement } from "../../core/workspaces/application.ts";
import { loadSchemaType } from "./schema-type.ts";
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
import type {
  PreparedSchemaChange,
  SchemaChangeDraftContext,
  SchemaChangeStore,
} from "../../core/entity-types/schema-changes.ts";
import type {
  EntitySchemaChange,
  EntitySchemaChangeSummary,
  SchemaAnalysis,
  SchemaAnalysisPage,
  SchemaDefinition,
  SchemaEdit,
} from "../../contracts/entity-schema-change.ts";
import { AppError, conflict, invalidInput, notFound } from "../../core/shared/errors.ts";
import { jsonbText, publicationDefinition } from "../../core/entity-types/schema-rules.ts";
export class SqlSchemaChangeStore implements SchemaChangeStore {
  constructor(
    protected readonly tx: postgres.TransactionSql,
    protected readonly actor: Actor,
    protected readonly modelChangeId?: string,
  ) {}
  protected get schemaWorkspaceId(): string {
    return requireWorkspaceActor(this.actor).workspaceId;
  }
  protected async authorizeSchemaPermissions(requirements: WorkspaceRequirement[]) {
    if (!requirements.length) return;
    await authorizeWorkspace(this.tx, requirements);
    await this.tx`select set_config('request.workspace_requirements',
      (coalesce(nullif(current_setting('request.workspace_requirements',true),''),'[]')::jsonb || ${
      this.tx.json(requirements as never)
    }::jsonb)::text,true)`;
  }
  protected async authorizeSchemaKinds(ids: string[], access: "read" | "write") {
    await this.authorizeSchemaPermissions(
      [...new Set(ids)].sort().map((id) => ({ target_kind: "entity_type", target_id: id, access })),
    );
  }
  protected async assertChangeAffiliation(id: string) {
    const [row] = await this.tx`select model_change_id from app.entity_schema_changes where id=${id}::uuid`;
    if (row?.model_change_id && row.model_change_id !== this.modelChangeId) {
      throw invalidInput("전체 모델 소속 변경은 자료 모델에서 함께 처리하세요");
    }
  }
  protected async lockType(typeId: string) {
    const t = await loadSchemaType(this.tx, typeId, true);
    if (!t) throw notFound();
    if (t.schema_write_locked) {
      throw new AppError("schema_migration_in_progress", "마이그레이션 완료 후 다시 시도하세요");
    }
    return t;
  }
  protected sourceRefs(t: postgres.Row, i: { expected_type_version: number; expected_schema_version: number }) {
    if (t.schema_version !== i.expected_schema_version) {
      throw new AppError("schema_changed", "자료 종류나 속성 정의가 변경되었습니다", undefined, {
        type_id: t.id,
        schema_version: Number(t.schema_version),
      });
    }
  }
  protected async definition(t: postgres.Row): Promise<SchemaDefinition> {
    const [v] = await this
      .tx`select schema from app.entity_schema_versions where type_id=${t.id} and schema_version=${t.schema_version}`;
    return { schema: v.schema };
  }
  protected async templates(target: SchemaDefinition, typeId: string, expected?: string) {
    await this.tx`select pg_advisory_xact_lock(hashtextextended(${`${this.schemaWorkspaceId}:record_templates`},0))`;
    const [row] = await this.tx`select version,settings from app.user_business_settings where id='record_templates'`;
    const version = await effectiveEntityTemplateFingerprint(row?.settings as RecordTemplates | undefined, typeId);
    if (expected !== undefined && version !== expected) {
      throw new AppError("schema_plan_stale", "기록 템플릿이 변경되었습니다. 새 변경과 분석을 준비하세요");
    }
    assertSchemaTemplateReferences(target, (row?.settings ?? {}) as RecordTemplates, typeId);
    return version;
  }
  async lockSchemaChangeBindings(typeId: string, ids: string[]): Promise<RecordTemplates> {
    if (ids.length) {
      await this.authorizeSchemaKinds([typeId], "write");
      const [r] = await this
        .tx`select count(*)::int as count from app.entities where entity_type_id=${typeId} and id=any(${ids}::text[])`;
      if (r.count !== ids.length) throw notFound();
    }
    await this.tx`select pg_advisory_xact_lock(hashtextextended(${`${this.schemaWorkspaceId}:record_templates`},0))`;
    const [row] = await this.tx`select settings from app.user_business_settings where id='record_templates'`;
    return row?.settings ?? {};
  }
  async reserveSchemaChangeProperties(typeId: string, edits: SchemaEdit[], prior: Record<string, string>) {
    const [t] = await this.tx`select * from app.entity_types where id=${typeId} for update`;
    if (!t) throw notFound();
    return this.reserve(t, edits, prior);
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
      .tx`select coalesce(e.id,r.entity_id) as id from app.entities e full join private.entity_schema_migration_rows r on r.workspace_id=e.workspace_id and r.entity_id=e.id and r.job_id=${j.id} where (e.entity_type_id=${typeId} or r.job_id=${j.id}) and (e.id is null or r.entity_id is null or e.version<>r.committed_version or e.deleted_at is distinct from r.source_deleted_at) order by coalesce(e.id,r.entity_id) limit 20`;
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
        .tx`select app.entity_schema_membership(${this.schemaWorkspaceId},${t.id})=${j.committed_membership} as values, app.entity_schema_reference_baseline(${this.schemaWorkspaceId},${t.id})=${
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
  protected async recoveryFresh(sourceJobId: string | null, typeId: string, lock = true) {
    if (!sourceJobId) return;
    const [j] = await this.tx`select * from app.entity_schema_migrations where id=${sourceJobId} ${
      lock ? this.tx`for update` : this.tx``
    }`;
    if (!j) throw notFound();
    const t = await loadSchemaType(this.tx, typeId);
    if (!t) throw notFound();
    const read = await this.recoveryEvidence(j, t);
    assertRecoveryFresh(read.evidence, new Date(read.observed_at));
  }
  protected async row(typeId: string, id: string, lock = false) {
    const [header] = await this
      .tx`select requirements from app.workspace_schema_headers('change',${id}::uuid,${typeId}::uuid)`;
    if (!header) throw notFound();
    await this.authorizeSchemaPermissions(
      (header.requirements as WorkspaceRequirement[]).map((r) => ({ ...r, access: "read" })),
    );
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
    if (row.analysis_id) {
      await this.authorizeSchemaPermissions(
        (row.required_permissions ?? [{ target_kind: "entity_type", target_id: row.type_id }]).map((
          r: WorkspaceRequirement,
        ) => ({ ...r, access: "read" })),
      );
    }
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
        .tx`select schema_version=${row.source_schema_version} and (not schema_write_locked or exists(select 1 from app.entity_schema_migrations j where j.change_id=${row.id} and j.status in ('queued','preparing','ready_to_commit','committing'))) as fresh from app.entity_types where id=${row.type_id}`;
      if (!fresh?.fresh) status = "stale";
      const [settings] = await this.tx`select settings from app.user_business_settings where id='record_templates'`;
      if (
        await effectiveEntityTemplateFingerprint(settings?.settings, row.type_id) !== row.source_template_fingerprint
      ) status = "stale";
      if (analysis) {
        const [a] = await this
          .tx`select membership=app.entity_schema_membership(workspace_id,type_id) as fresh from app.entity_schema_analyses where id=${row.analysis_id}`;
        if (!a?.fresh) status = "stale";
      }
    }
    return {
      id: row.id,
      type_id: row.type_id,
      source_schema_version: Number(row.source_schema_version),
      source_template_fingerprint: row.source_template_fingerprint,
      version: Number(row.version),
      status,
      change_kind: row.kind,
      edits: retainedSchemaEdits(row),
      migration: row.migration ?? { rules: [], overrides: [] },
      recovery: row.recovery_source_job_id
        ? { source_job_id: row.recovery_source_job_id, source_expires_at: row.recovery_expires_at.toISOString() }
        : null,
      executable: status === "ready" && analysis?.status === "succeeded" && analysis.failed === 0,
      reservations: row.reservations,
      target: normalizeStoredEntityDefinition(row.target, row.type_id, Number(row.source_schema_version) + 1),
      diff: row.diff,
      fingerprint: row.fingerprint,
      analysis,
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
    };
  }
  async loadSchemaDiscard(typeId: string, id: string) {
    await this.assertChangeAffiliation(id);
    // Match worker/publication lock order: type → change → analysis.
    const [type] = await this.tx`select id from app.entity_types where id::text=${typeId} for update`;
    if (!type) throw notFound();
    const change = await this.row(typeId, id, true);
    const [active] = await this
      .tx`select exists(select 1 from app.entity_schema_migrations where change_id=${change.id} and status in ('queued','preparing','ready_to_commit','committing')) as present`;
    return {
      change: { version: Number(change.version), status: change.status as EntitySchemaChange["status"] },
      migration_active: active.present,
    };
  }
  async saveSchemaDiscard(typeId: string, id: string) {
    const row = await this.row(typeId, id);
    if (row.analysis_id) {
      await this
        .tx`update app.entity_schema_analyses set status='failed',failure_reason='analysis_discarded',retryable=false,fence=fence+1,lease_until=null where id=${row.analysis_id} and status in ('queued','running')`;
    }
    const [saved] = await this
      .tx`update app.entity_schema_changes set status='cancelled',version=version+1,updated_at=now() where id=${row.id} returning *`;
    return this.dto(saved);
  }
  async loadSchemaChangeDraft(typeId: string): Promise<SchemaChangeDraftContext> {
    const t = await loadSchemaType(this.tx, typeId, true);
    if (!t) throw notFound();
    const rows = await this
      .tx`select field.key as property,array_agg(distinct app.identifier_kind(field.value#>>'{}')::text) as kinds
      from app.entities e cross join lateral jsonb_each(e.properties) field
      where e.entity_type_id=${typeId} and jsonb_typeof(field.value)='string'
      and exists(select 1 from app.entity_schema_versions s where s.type_id=${typeId} and s.schema_version=${t.schema_version}
       and s.schema->'properties'->field.key ? 'x-identifier') group by field.key`;
    const [membership] = await this
      .tx`select exists(select 1 from app.entities where entity_type_id=${typeId}) as present`;
    return {
      type: {
        id: t.id,
        version: Number(t.version),
        schema_version: Number(t.schema_version),
        archived: t.archived,
        schema_write_locked: t.schema_write_locked,
      },
      definition: await this.definition(t),
      has_entities: membership.present,
      identifier_usage: Object.fromEntries(rows.map((row) => [row.property, row.kinds])),
      previous: null,
    };
  }
  async lockExistingSchemaChange(
    typeId: string,
    id: string,
  ): Promise<NonNullable<SchemaChangeDraftContext["previous"]>> {
    await this.assertChangeAffiliation(id);
    const row = await this.row(typeId, id, true);
    return {
      id: row.id,
      version: Number(row.version),
      status: row.status,
      source_schema_version: Number(row.source_schema_version),
      source_template_fingerprint: row.source_template_fingerprint,
      edits: row.edits,
      migration: row.migration,
      reservations: row.reservations,
      recovery_source_job_id: row.recovery_source_job_id,
    };
  }
  async saveSchemaChangeDraft(context: SchemaChangeDraftContext, prepared: PreparedSchemaChange) {
    const { type: t, previous } = context;
    const { edits, migration, reservations, target, diff, kind, fingerprint, source_template_fingerprint } = prepared;
    const [r] = previous
      ? await this
        .tx`update app.entity_schema_changes set version=version+1,status='draft',analysis_id=null,migration=${
        this.tx.json(migration as never)
      },edits=${this.tx.json(edits as never)},reservations=${this.tx.json(reservations)},target=${
        this.tx.json(target as never)
      },diff=${
        this.tx.json(diff as never)
      },kind=${kind},fingerprint=${fingerprint},updated_at=now() where id=${previous.id} returning *`
      : await this
        .tx`insert into app.entity_schema_changes(workspace_id,type_id,source_type_version,source_schema_version,source_template_fingerprint,migration,edits,reservations,target,diff,kind,fingerprint) values(${this.schemaWorkspaceId},${t.id},${t.version},${t.schema_version},${source_template_fingerprint},${
        this.tx.json(migration as never)
      },${this.tx.json(edits as never)},${this.tx.json(reservations)},${this.tx.json(target as never)},${
        this.tx.json(diff as never)
      },${kind},${fingerprint}) returning *`;
    return this.dto(r);
  }
  async getChange(typeId: string, id: string) {
    return this.dto(await this.row(typeId, id));
  }
  async listChanges(typeId: string, input: Parameters<SchemaChangeStore["listChanges"]>[1]) {
    const [t] = await this.tx`select id from app.entity_types where id::text=${typeId}`;
    if (!t) throw notFound();
    const headers = await this.tx`select requirements from app.workspace_schema_headers('change',null,${typeId}::uuid,${
      input.before ?? null
    }::uuid,${input.limit + 1})`;
    await this.authorizeSchemaPermissions(
      headers.flatMap((r) =>
        (r.requirements as WorkspaceRequirement[]).map((permission) => ({ ...permission, access: "read" as const }))
      ),
    );
    const rows = await this.tx`select * from app.entity_schema_changes where type_id=${typeId} and (${
      input.before ?? null
    }::uuid is null or id<${input.before ?? null}::uuid) order by id desc limit ${input.limit + 1}`;
    return {
      items: rows.slice(0, input.limit).map((r): EntitySchemaChangeSummary => ({
        id: r.id,
        type_id: r.type_id,
        source_schema_version: Number(r.source_schema_version),
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
    await this.assertChangeAffiliation(id);
    await this.authorizeSchemaKinds([typeId], "write");
    const t = await this.lockType(typeId);
    const row = await this.row(typeId, id, true);
    this.editable(row, input.expected_change_version);
    this.sourceRefs(t, {
      expected_type_version: Number(row.source_type_version),
      expected_schema_version: Number(row.source_schema_version),
    });
    await this.recoveryFresh(row.recovery_source_job_id, typeId);
    await this.templates(row.target, typeId, row.source_template_fingerprint);
    const overrides = row.migration?.overrides ?? [];
    for (const override of overrides) {
      const [entity] = await this
        .tx`select id from app.entities where entity_type_id=${typeId} and id=${override.entity_id}`;
      if (!entity) throw notFound();
    }
    const [a] = await this
      .tx`with snapshot as materialized (select workspace_id,id,version,schema_version,properties,deleted_at from app.entities where workspace_id=${this.schemaWorkspaceId}::uuid and entity_type_id=${typeId}), size as (select count(*)::int as count,coalesce(sum(octet_length(jsonb_build_array(id,version,schema_version,properties,deleted_at)::text)),0)::bigint as bytes from snapshot), analysis as (insert into app.entity_schema_analyses(workspace_id,type_id,change_id,change_version,fingerprint,membership,total) select ${this.schemaWorkspaceId},${typeId},${id},${row.version},${row.fingerprint},md5(coalesce((select jsonb_agg(jsonb_build_array(id,version,schema_version,properties,deleted_at) order by id)::text from snapshot),'[]')),count from size where count<=2000 and bytes<=8388608 returning id) select a.id,(select count(*) from snapshot) as captured,coalesce((select jsonb_agg(to_jsonb(s) order by s.id) from snapshot s),'[]'::jsonb) as rows from analysis a`;
    if (!a) throw invalidInput("영향 분석은 2000개·8 MiB 이하에서 실행할 수 있습니다");
    // A source-row policy resolves its persisted analysis. A data-modifying CTE
    // cannot see a sibling INSERT through that policy's statement snapshot.
    // Retain the exact bounded snapshot above, then write it in a new statement.
    await this
      .tx`insert into private.entity_schema_analysis_rows(workspace_id,analysis_id,entity_id,source_version,source_schema_version,properties,deleted_at,recovery_properties)
      select ${this.schemaWorkspaceId}::uuid,${a.id}::uuid,r.id,r.version,r.schema_version,r.properties,r.deleted_at,
        (select source.source_properties from private.entity_schema_migration_rows source where source.workspace_id=${this.schemaWorkspaceId}::uuid
          and source.job_id=${row.recovery_source_job_id}::uuid and source.entity_id=r.id)
      from jsonb_to_recordset(${this.tx.json(a.rows)}::jsonb)
        r(id text,version integer,schema_version integer,properties jsonb,deleted_at timestamptz)`;

    if (row.recovery_source_job_id) {
      const [size] = await this
        .tx`select coalesce(sum(octet_length(properties::text)+octet_length(recovery_properties::text)),0) as bytes from private.entity_schema_analysis_rows where analysis_id=${a.id}`;
      if (Number(size.bytes) > 8388608) throw invalidInput("복구 분석 원본은 8 MiB 이하에서 실행할 수 있습니다");
    }
    const empty = Number(a.captured) === 0 && !row.recovery_source_job_id;
    if (empty) {
      // The type lock and captured membership make this an exact empty snapshot, not an estimate.
      await this
        .tx`update app.entity_schema_analyses set status='succeeded',processed=0,failed=0,lease_until=null where id=${a.id}`;
    }
    await this
      .tx`update app.entity_schema_changes set status=${
      empty ? "ready" : "analyzing"
    },analysis_id=${a.id},updated_at=now() where id=${id}`;
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
    await this.authorizeSchemaKinds([typeId], "read");
    const change = await this.row(typeId, id);
    await this.recoveryFresh(change.recovery_source_job_id, typeId, false);
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
    await this.assertChangeAffiliation(id);
    await this.authorizeSchemaKinds([typeId], "write");
    // Metadata writes and worker publication use the same workspace -> type lock order.
    await this.tx`select pg_advisory_xact_lock(hashtextextended(${this.schemaWorkspaceId + ":entity-types"},0))`;
    const t = await loadSchemaType(this.tx, typeId, true);
    if (!t) throw notFound();
    const c = await this.row(typeId, id, true);
    const [a] = await this
      .tx`select * from app.entity_schema_analyses where id::text=${analysisId} and change_id=${id}`;
    if (a) {
      const [registry] = await this.tx`select app.entity_schema_registry_current(${analysisId}::uuid) as current`;
      if (!registry.current) {
        throw new AppError("schema_plan_stale", "식별자 종류가 변경되었습니다. 새 영향 분석을 준비하세요");
      }
    }
    const [epoch] = await this.tx`select app.workspace_generation() as generation`;
    if (
      Number(c.workspace_generation) !== Number(epoch.generation) ||
      (a && Number(a.workspace_generation) !== Number(epoch.generation))
    ) {
      throw new AppError(
        "schema_plan_stale",
        "삭제 전 변경안과 분석은 다시 실행할 수 없습니다. 새 변경안을 준비하세요",
      );
    }
    const [fresh] = await this
      .tx`select app.entity_schema_membership(${this.schemaWorkspaceId},${typeId}) as membership`;
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
    await this.tx`select pg_advisory_xact_lock(hashtextextended(${`${this.schemaWorkspaceId}:record_templates`},0))`;
    const [row] = await this.tx`select settings from app.user_business_settings where id='record_templates'`;
    if (recovery) recovery.observed_at = await this.recoveryObservedAt();
    return { recovery, templates: row?.settings ?? {} };
  }
  async saveSchemaPublication(context: SchemaApplicationContext, next: number) {
    const typeId = context.type.id, id = context.change.id, row = context.change;
    const metadata = row.target.schema;
    if (!metadata.deprecated && (context.type.archived || context.type.label !== metadata.title)) {
      await this.tx`select pg_advisory_xact_lock(hashtextextended(${this.schemaWorkspaceId + ":entity-types"},0))`;
      const [duplicate] = await this
        .tx`select 1 from app.entity_types t join app.entity_schema_versions v on v.workspace_id=t.workspace_id and v.type_id=t.id and v.schema_version=t.schema_version where t.id<>${typeId} and not coalesce((v.schema->>'deprecated')::boolean,false) and v.schema->>'title'=${
        metadata.title ?? ""
      } limit 1`;
      if (duplicate) {
        throw invalidInput("같은 이름의 자료 종류가 있습니다. 다른 이름을 입력하세요", [{
          path: "schema.title",
          message: "사용 중인 이름입니다",
        }]);
      }
    }
    await this
      .tx`insert into app.entity_schema_versions(workspace_id,schema) values(${this.schemaWorkspaceId},${
      this.tx.json(publicationDefinition(row.target, typeId, next).schema)
    })`;
    await this
      .tx`update app.entity_types set schema_version=${next},updated_at=now() where id=${typeId}`;
    const [r] = await this
      .tx`update app.entity_schema_changes set status='applied',updated_at=now() where id=${id} returning *`;
    return this.dto(r);
  }
}

function retainedSchemaEdits(row: postgres.Row): SchemaEdit[] {
  const target = normalizeStoredEntityDefinition(row.target, row.type_id, Number(row.source_schema_version) + 1);
  if (
    !(row.edits as Array<{ op: string }>).some((e) => e.op === "set_display") &&
    !(row.target as { display?: unknown }).display &&
    !Object.values(row.target.schema.properties as Record<string, Record<string, unknown>>).some((field) =>
      ["x-representative", "x-show-in-list", "x-list-order"].some((key) => Object.hasOwn(field, key))
    )
  ) return row.edits;
  const edits: SchemaEdit[] = [];
  for (const edit of row.edits as Array<SchemaEdit | { op: "set_display" }>) {
    if (edit.op === "set_display") continue;
    if (edit.op === "add_property") {
      const key = row.reservations[edit.client_ref];
      edits.push({ ...edit, field: target.schema.properties[key] });
    } else if (edit.op === "update_property") edits.push({ ...edit, field: target.schema.properties[edit.key] });
    else edits.push(edit);
  }
  return edits;
}

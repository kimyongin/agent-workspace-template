import { assertSchemaTemplateReferences } from "../../core/entity-types/template-references.ts";
import type { RecordTemplates } from "../../contracts/record-template.ts";
import type postgres from "postgres";
import type { Actor } from "../../core/shared/actor.ts";
import type { SchemaChangeStore } from "../../core/entity-types/schema-changes.ts";
import type {
  EntitySchemaChange,
  EntitySchemaChangeSummary,
  SchemaAnalysis,
  SchemaDefinition,
  SchemaEdit,
} from "../../contracts/entity-schema-change.ts";
import { AppError, conflict, invalidInput, notFound } from "../../core/shared/errors.ts";
import { canonical, definitionFingerprint, resolveSchemaEdits } from "../../core/entity-types/evolution.ts";
export class SqlSchemaChangeStore implements SchemaChangeStore {
  constructor(protected readonly tx: postgres.TransactionSql, protected readonly actor: Actor) {}
  private async lockType(typeId: string) {
    const [t] = await this.tx`select * from app.entity_types where id::text=${typeId} for update`;
    if (!t) throw notFound();
    if (t.schema_write_locked) {
      throw new AppError("schema_migration_in_progress", "마이그레이션 완료 후 다시 시도하세요");
    }
    return t;
  }
  private sourceRefs(t: postgres.Row, i: { expected_type_version: number; expected_schema_version: number }) {
    if (t.version !== i.expected_type_version || t.schema_version !== i.expected_schema_version) {
      throw new AppError("schema_changed", "자료 종류나 속성 정의가 변경되었습니다", undefined, {
        type_id: t.id,
        type_version: Number(t.version),
        schema_version: Number(t.schema_version),
      });
    }
    if (t.archived) throw new AppError("entity_type_archived", "보관된 자료 종류를 먼저 복원하세요");
  }
  private async definition(t: postgres.Row): Promise<SchemaDefinition> {
    const [v] = await this
      .tx`select schema,display from app.entity_schema_versions where type_id=${t.id} and schema_version=${t.schema_version}`;
    return { schema: v.schema, display: v.display };
  }
  private async templates(target: SchemaDefinition, expected?: number) {
    await this.tx`select pg_advisory_xact_lock(hashtextextended(${`${this.actor.userId}:record_templates`},0))`;
    const [row] = await this.tx`select version,settings from app.user_business_settings where id='record_templates'`;
    const version = Number(row?.version ?? 0);
    if (expected !== undefined && version !== expected) {
      throw new AppError("schema_plan_stale", "기록 템플릿이 변경되었습니다. 새 변경과 분석을 준비하세요");
    }
    assertSchemaTemplateReferences(target, (row?.settings ?? {}) as RecordTemplates);
    return version;
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
  private async row(typeId: string, id: string, lock = false) {
    const [row] = await this
      .tx`select * from app.entity_schema_changes where type_id::text=${typeId} and id::text=${id} ${
      lock ? this.tx`for update` : this.tx``
    }`;
    if (!row) throw notFound();
    return row;
  }
  private editable(row: postgres.Row, version: number) {
    if (Number(row.version) !== version) throw conflict("변경 초안 버전이 변경되었습니다");
    if (["applied", "cancelled"].includes(row.status)) throw conflict("완료된 변경은 수정할 수 없습니다");
  }
  private async dto(row: postgres.Row): Promise<EntitySchemaChange> {
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
          processed: Number(a.processed),
          failed: Number(a.failed),
          errors: errors.map((r) => ({ entity_id: r.entity_id, fields: r.errors })),
          created_at: a.created_at.toISOString(),
        };
      }
    }
    if (!["applied", "cancelled"].includes(status)) {
      const [fresh] = await this
        .tx`select version=${row.source_type_version} and schema_version=${row.source_schema_version} and not schema_write_locked and coalesce((select s.version from app.user_business_settings s where s.owner_id=app.entity_types.owner_id and s.id='record_templates'),0)=${row.source_template_version} as fresh from app.entity_types where id=${row.type_id}`;
      if (!fresh?.fresh) status = "stale";
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
      source_template_version: Number(row.source_template_version),
      version: Number(row.version),
      status,
      change_kind: row.kind,
      edits: row.edits,
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
    const templateVersion = await this.templates(resolved.target);
    const fingerprint = await definitionFingerprint({
      type_id: typeId,
      source_type_version: t.version,
      source_schema_version: t.schema_version,
      source_template_version: templateVersion,
      edits: input.edits,
      reservations,
      target: resolved.target,
    });
    const [r] = await this
      .tx`insert into app.entity_schema_changes(owner_id,type_id,source_type_version,source_schema_version,source_template_version,edits,reservations,target,diff,kind,fingerprint) values(${this.actor.userId},${typeId},${t.version},${t.schema_version},${templateVersion},${
      this.tx.json(input.edits as never)
    },${this.tx.json(reservations)},${this.tx.json(resolved.target as never)},${
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
    const reservations = await this.reserve(t, input.edits, row.reservations);
    const resolved = resolveSchemaEdits(await this.definition(t), input.edits, reservations);
    await this.templates(resolved.target, Number(row.source_template_version));
    if (canonical(input.edits) === canonical(row.edits)) return this.dto(row);
    const fingerprint = await definitionFingerprint({
      type_id: typeId,
      source_type_version: t.version,
      source_schema_version: t.schema_version,
      source_template_version: row.source_template_version,
      edits: input.edits,
      reservations,
      target: resolved.target,
    });
    const [r] = await this
      .tx`update app.entity_schema_changes set version=version+1,status='draft',analysis_id=null,edits=${
      this.tx.json(input.edits as never)
    },reservations=${this.tx.json(reservations)},target=${this.tx.json(resolved.target as never)},diff=${
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
    await this.templates(row.target, Number(row.source_template_version));
    const [size] = await this
      .tx`select count(*)::int as count,coalesce(sum(octet_length(jsonb_build_array(id,version,schema_version,properties,deleted_at)::text)),0)::bigint as bytes from app.entities where entity_type_id=${typeId}`;
    if (size.count > 2000 || Number(size.bytes) > 8388608) {
      throw invalidInput("영향 분석은 2000개·8 MiB 이하에서 실행할 수 있습니다");
    }
    const [a] = await this
      .tx`insert into app.entity_schema_analyses(owner_id,type_id,change_id,change_version,fingerprint,membership,total) values(${this.actor.userId},${typeId},${id},${row.version},${row.fingerprint},app.entity_schema_membership(${this.actor.userId},${typeId}),${size.count}) returning id`;
    await this
      .tx`insert into private.entity_schema_analysis_rows(owner_id,analysis_id,entity_id,source_version,source_schema_version,properties,deleted_at) select owner_id,${a.id},id,version,schema_version,properties,deleted_at from app.entities where entity_type_id=${typeId}`;
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
  async applyChange(typeId: string, id: string, input: Parameters<SchemaChangeStore["applyChange"]>[2]) {
    const t = await this.lockType(typeId);
    const row = await this.row(typeId, id, true);
    this.editable(row, input.expected_change_version);
    this.sourceRefs(t, {
      expected_type_version: Number(row.source_type_version),
      expected_schema_version: Number(row.source_schema_version),
    });
    if (row.kind !== "compatible") {
      throw new AppError(
        "schema_migration_required",
        "이 변경은 값 변환 작업이 필요합니다",
        row.diff.filter((d: { kind: string }) => d.kind === "migration_required").map((
          d: { path: string; reason: string },
        ) => ({ path: d.path, message: d.reason })),
      );
    }
    const [a] = await this
      .tx`select * from app.entity_schema_analyses where id::text=${input.analysis_id} and change_id=${id}`;
    const [fresh] = await this.tx`select app.entity_schema_membership(${this.actor.userId},${typeId}) as membership`;
    if (
      row.status !== "ready" || row.analysis_id !== input.analysis_id || !a || a.status !== "succeeded" ||
      a.failed !== 0 || a.change_version !== row.version || a.fingerprint !== row.fingerprint ||
      a.membership !== fresh.membership
    ) throw new AppError("schema_plan_stale", "최신 영향 분석을 완료하세요");
    await this.templates(row.target, Number(row.source_template_version));
    const next = Number(t.schema_version) + 1;
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

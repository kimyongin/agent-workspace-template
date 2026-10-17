import { receiptChange, SqlDataModelStore } from "./data-model-store.ts";
import { effectiveEntityTemplates } from "../../contracts/record-template.ts";
import { SqlSchemaMigrationStore } from "./schema-migration-store.ts";
import { canonical, definitionFingerprint, schemaDefinitionDiff } from "../../core/entity-types/evolution.ts";
import {
  assertSchemaTemplateReferences,
  effectiveEntityTemplateFingerprint,
} from "../../core/entity-types/template-references.ts";
import {
  assertSchemaApplication,
  assertSchemaApplicationBindings,
} from "../../core/entity-types/schema-application.ts";
import { AppError, invalidInput } from "../../core/shared/errors.ts";
import type { ModelChange, ModelGroupAnalyze } from "../../contracts/data-model.ts";
import type { MigrationPlan } from "../../contracts/entity-schema-change.ts";
import type { ModelPlan } from "../../core/data-model/application.ts";
type GroupPlan = ModelPlan & { conversion_refs?: string[] };
export class SqlDataModelGroupStore extends SqlDataModelStore {
  override async get(id: string, lock = false) {
    const c = await super.get(id, lock);
    if (!c) return null;
    const plan = c.plan as GroupPlan;
    if (!plan.conversion_refs) return c;
    const rows = await this
      .tx`select c.*,g.retryable,g.failure_reason from app.data_model_children c join app.data_model_changes g on g.owner_id=c.owner_id and g.id=c.model_id where c.model_id=${id}::uuid order by c.type_id`;
    const store = new SqlSchemaMigrationStore(this.tx, this.actor, id);
    const children = await Promise.all(
      rows.map(async (r) => ({
        type_ref: String(r.type_ref),
        change: await store.getChange(r.type_id, r.change_id),
        source: { schema: plan.source.entity_types.find((t) => t.schema["x-type-id"] === r.type_id)!.schema },
        job: r.job_id ? await store.getMigration(r.job_id) : null,
      })),
    );
    const [parent] = await this.tx`select retryable,failure_reason from app.data_model_changes where id=${id}::uuid`;
    const group: NonNullable<ModelChange["group"]> = {
      children,
      total: children.reduce((n, c) => n + (c.job?.total ?? c.change.analysis?.total ?? 0), 0),
      processed: children.reduce((n, c) => n + (c.job?.processed ?? c.change.analysis?.processed ?? 0), 0),
      failed: children.reduce((n, c) => n + (c.change.analysis?.failed ?? 0), 0),
      retryable: Boolean(parent.retryable),
      failure_reason: parent.failure_reason ?? null,
    };
    return { ...c, group };
  }
  async analyzeGroup(id: string, input: ModelGroupAnalyze) {
    const c = (await this.get(id, true))!, plan = c.plan as GroupPlan, snapshot = await this.snapshot();
    if (
      canonical(snapshot.document) !== canonical(plan.source) ||
      (!plan.conversion_refs && await definitionFingerprint(snapshot) !== plan.baseline)
    ) throw new AppError("schema_plan_stale", "모델이 변경되었습니다. 전체 파일을 다시 검토하세요");
    const refs = plan.review.items.filter((i) =>
      i.kind === "migration_required" && plan.target.entity_types.some((t) => t.ref === i.ref)
    ).map((i) => i.ref);
    for (const conversion of input.conversions) {
      if (
        !refs.includes(conversion.type_ref) &&
        (conversion.migration.rules.length || conversion.migration.overrides.length)
      ) throw invalidInput("값 변환이 필요한 종류에만 변환을 지정하세요");
    }
    const [settings] = await this.tx`select settings from app.user_business_settings where id='record_templates'`;
    const store = new SqlSchemaMigrationStore(this.tx, this.actor, id);
    for (const ref of refs) {
      const target = plan.target.entity_types.find((t) => t.ref === ref)!, typeId = target.schema["x-type-id"];
      const [type] = await this.tx`select * from app.entity_types where id=${typeId}::uuid for update`;
      if (type.schema_write_locked) throw new AppError("schema_migration_in_progress", "다른 값 변환이 진행 중입니다");
      assertSchemaTemplateReferences({ schema: target.schema }, settings?.settings ?? {}, typeId);
      const template = await effectiveEntityTemplateFingerprint(settings?.settings, typeId);
      const migration: MigrationPlan = input.conversions.find((i) => i.type_ref === ref)?.migration ??
        { rules: [], overrides: [] };
      const edits = (plan.remove_keys?.[ref] ?? []).map((key) => ({ op: "remove_property", key }));
      const diff = schemaDefinitionDiff({
        schema: plan.source.entity_types.find((t) => t.schema["x-type-id"] === typeId)!.schema,
      }, { schema: target.schema });
      const fingerprint = await definitionFingerprint({ id, ref, target: target.schema, migration, template });
      const [previous] = await this
        .tx`select * from app.data_model_children where model_id=${id}::uuid and type_ref=${ref}`;
      if (previous?.analysis_id) {
        await this
          .tx`update app.entity_schema_analyses set status='failed',fence=fence+1,lease_until=null,retryable=false,failure_reason='analysis_discarded' where id=${previous.analysis_id}::uuid`;
      }
      if (previous?.job_id) {
        await this
          .tx`update app.entity_schema_migrations set retryable=false,fence=fence+1 where id=${previous.job_id}::uuid`;
      }
      const [draft] = previous
        ? await this
          .tx`update app.entity_schema_changes set version=version+1,status='draft',analysis_id=null,source_template_fingerprint=${template},migration=${
          this.tx.json(migration as never)
        },fingerprint=${fingerprint},updated_at=now() where id=${previous.change_id}::uuid returning *`
        : await this
          .tx`insert into app.entity_schema_changes(owner_id,type_id,source_type_version,source_schema_version,source_template_fingerprint,migration,edits,reservations,target,diff,kind,fingerprint,model_change_id) values(${this.actor.userId},${typeId},${type.schema_version},${type.schema_version},${template},${
          this.tx.json(migration as never)
        },${this.tx.json(edits)},'{}',${this.tx.json({ schema: target.schema } as never)},${
          this.tx.json(diff as never)
        },'migration_required',${fingerprint},${id}) returning *`;
      await this
        .tx`insert into app.data_model_children(owner_id,model_id,type_ref,type_id,change_id) values(${this.actor.userId},${id},${ref},${typeId},${draft.id}) on conflict(owner_id,model_id,type_ref) do update set analysis_id=null,job_id=null`;
      const maxKey = Math.max(1, ...Object.keys(target.schema.properties).map((k) => Number(k.slice(5)))) + 1;
      await this
        .tx`update app.entity_types set next_property_number=greatest(next_property_number,${maxKey}) where id=${typeId}::uuid`;
      const accepted = await store.analyzeChange(typeId, draft.id, { expected_change_version: Number(draft.version) });
      await this
        .tx`update app.data_model_children set analysis_id=${accepted.analysis_id}::uuid where model_id=${id}::uuid and type_ref=${ref}`;
    }
    plan.conversion_refs = refs;
    plan.baseline = await definitionFingerprint(await this.snapshot());
    await this.tx`update app.data_model_changes set plan=${
      this.tx.json(plan as never)
    },status='analyzing',version=version+1,retryable=false,failure_reason=null where id=${id}::uuid`;
    await this.tx`select app.refresh_data_model_analysis(${id}::uuid)`;
    return receiptChange((await this.get(id))!);
  }
  async startGroup(id: string) {
    const c = (await this.get(id, true))!, plan = c.plan as GroupPlan;
    if (c.status !== "ready" || !plan.conversion_refs?.length) {
      throw invalidInput("전체 종류의 최신 성공 분석을 준비하세요");
    }
    if (await definitionFingerprint(await this.snapshot()) !== plan.baseline) {
      throw new AppError("schema_plan_stale", "분석 후 모델 또는 자료가 변경되었습니다. 다시 분석하세요");
    }
    const store = new SqlSchemaMigrationStore(this.tx, this.actor, id);
    const [settings] = await this.tx`select settings from app.user_business_settings where id='record_templates'`;
    const templates: Record<string, unknown> = {}, memberships: Record<string, string> = {};
    for (const t of plan.source.entity_types) {
      const [m] = await this.tx`select app.entity_schema_membership(${this.actor.userId},${
        t.schema["x-type-id"]
      }) as value`;
      memberships[t.schema["x-type-id"]] = m.value;
    }
    for (const t of plan.target.entity_types) {
      assertSchemaTemplateReferences({ schema: t.schema }, settings?.settings ?? {}, t.schema["x-type-id"]);
      const effective = effectiveEntityTemplates(settings?.settings, t.schema["x-type-id"]);
      for (const value of Object.values(effective.entity!)) value!.tag_ids = [...value!.tag_ids].sort();
      templates[t.schema["x-type-id"]] = effective;
    }
    const rows = await this.tx`select * from app.data_model_children where model_id=${id}::uuid order by type_id`;
    for (const r of rows) {
      const context = await store.loadSchemaApplication(r.type_id, r.change_id, r.analysis_id);
      assertSchemaApplication(context, "migration_required", {
        expected_change_version: context.change.version,
        analysis_id: r.analysis_id,
      });
      await assertSchemaApplicationBindings(context, await store.lockSchemaApplicationBindings(context));
      const job = await store.saveSchemaMigration(context);
      await this.tx`update app.entity_schema_migrations set model_change_id=${id}::uuid where id=${job.job_id}::uuid`;
      await this
        .tx`update app.data_model_children set job_id=${job.job_id}::uuid where model_id=${id}::uuid and type_ref=${r.type_ref}`;
    }
    await this
      .tx`update app.data_model_changes set status='queued',version=version+1,fence=fence+1,source_memberships=${
      this.tx.json(memberships)
    },source_templates=${
      this.tx.json(templates as never)
    },source_expires_at=now()+interval '30 days',updated_at=now() where id=${id}::uuid`;
    return receiptChange((await this.get(id))!);
  }
  async cancelGroup(id: string) {
    const c = (await this.get(id, true))!;
    if (["applied", "cancelled", "committing"].includes(c.status)) return receiptChange(c);
    const store = new SqlSchemaMigrationStore(this.tx, this.actor, id);
    const rows = await this.tx`select * from app.data_model_children where model_id=${id}::uuid order by type_id`;
    for (const r of rows) {
      if (r.job_id) {
        const context = await store.loadMigrationAction(r.job_id);
        await store.saveMigrationCancellation(context.job);
      }
      if (r.analysis_id) {
        await this
          .tx`update app.entity_schema_analyses set status='failed',fence=fence+1,lease_until=null,retryable=false,failure_reason='analysis_discarded' where id=${r.analysis_id}::uuid`;
      }
      await this
        .tx`update app.entity_schema_changes set status='cancelled',version=version+1,updated_at=now() where id=${r.change_id}::uuid`;
    }
    await this
      .tx`update app.data_model_changes set status='cancelled',version=version+1,fence=fence+1,lease_until=null,retryable=false,updated_at=now() where id=${id}::uuid`;
    return receiptChange((await this.get(id))!);
  }
  async retryGroup(id: string) {
    const c = (await this.get(id, true))!;
    const [parent] = await this.tx`select source_expires_at,retryable from app.data_model_changes where id=${id}::uuid`;
    if (parent.source_expires_at && parent.source_expires_at <= new Date()) {
      throw new AppError("migration_source_expired", "값 변환 원본의 보관 기간이 지났습니다. 새 분석을 준비하세요");
    }
    if (c.status !== "failed" || !parent.retryable) {
      throw invalidInput("재시도 가능한 전체 실패 작업만 재개할 수 있습니다");
    }
    if (await definitionFingerprint(await this.snapshot()) !== c.plan.baseline) {
      throw new AppError("schema_plan_stale", "원본이 바뀌었습니다. 새 분석을 준비하세요");
    }
    const store = new SqlSchemaMigrationStore(this.tx, this.actor, id);
    const rows = await this.tx`select * from app.data_model_children where model_id=${id}::uuid order by type_id`;
    for (const r of rows) {
      if (!r.job_id) throw invalidInput("전체 변환 작업이 없습니다");
      const { job } = await store.loadMigrationAction(r.job_id);
      const context = await store.loadSchemaApplication(job.type_id, job.change_id, job.analysis_id);
      assertSchemaApplication(context, "migration_required", {
        expected_change_version: job.change_version,
        analysis_id: job.analysis_id,
      });
      await assertSchemaApplicationBindings(context, await store.lockSchemaApplicationBindings(context));
      if (!await store.migrationReferencesFresh(job.id)) {
        throw new AppError("schema_plan_stale", "연결이 변경되었습니다. 새 분석을 준비하세요");
      }
      if (job.source_expires_at && new Date(job.source_expires_at) <= new Date()) {
        throw new AppError("migration_source_expired", "값 변환 원본의 보관 기간이 지났습니다");
      }
      await store.saveMigrationRetry(job);
    }
    await this
      .tx`update app.data_model_changes set status='queued',version=version+1,fence=fence+1,lease_until=null,retryable=false,failure_reason=null,updated_at=now() where id=${id}::uuid`;
    return receiptChange((await this.get(id))!);
  }
}

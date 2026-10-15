import { SqlEntityIssuerStore } from "./entity-issuer-store.ts";
import { executeSqlRequest } from "./request-ledger.ts";
import type { RequestIdentity } from "../../core/shared/request.ts";
import type postgres from "postgres";
import type {
  BusinessSettings,
  BusinessSettingsResult,
  BusinessSettingsUpdate,
} from "../../contracts/business-settings.ts";
import { resolvedBusinessSettings } from "../../contracts/business-settings.ts";
import type { Actor } from "../../core/shared/actor.ts";
import type { BusinessSettingsStore } from "../../core/settings/application.ts";
import { conflict, invalidInput } from "../../core/shared/errors.ts";
import { runAsActor } from "./sql-context.ts";
import { effectiveEntityTemplates, templateFields, type TemplateModel } from "../../contracts/record-template.ts";
import { assertSchemaTemplateReferences } from "../../core/entity-types/template-references.ts";
import type { RecordTemplates } from "../../contracts/record-template.ts";
import type { ChangeFacts } from "../../core/shared/changes.ts";
import { entityPresentationRow, loadEntityDefinition } from "./entity-values.ts";

export class SqlBusinessSettingsStore implements BusinessSettingsStore {
  constructor(private readonly tx: postgres.TransactionSql, private readonly actor: Actor) {}
  getTypeIdentity(typeId: string, lock = false) {
    return new SqlEntityIssuerStore(this.tx, this.actor).getTypeIdentity(typeId, lock);
  }
  definition(typeId: string, lock = false) {
    return loadEntityDefinition(this.tx, typeId, lock);
  }
  executeRequest<T>(request: RequestIdentity, execute: () => Promise<T>): Promise<T> {
    return executeSqlRequest(this.tx, this.actor, request, execute);
  }
  async get(): Promise<BusinessSettingsResult> {
    const rows = await this
      .tx`select id,version,settings from app.user_business_settings where owner_id=${this.actor.userId} and id='record_templates'`;
    const versions = { record_templates: 0 };
    const settings: BusinessSettings = {};
    for (const row of rows) {
      const id = row.id as keyof BusinessSettings;
      versions[id] = Number(row.version);
      Object.assign(settings, { [id]: row.settings });
    }
    return {
      versions,
      settings: resolvedBusinessSettings(settings),
    };
  }
  async update({ id, expected_version: expected, value }: BusinessSettingsUpdate): Promise<BusinessSettingsResult> {
    if (id === "record_templates") {
      const templates = value as RecordTemplates, previous = (await this.get()).settings.record_templates;
      const types = await this.tx<{ id: string }[]>`select id from app.entity_types order by id`;
      for (
        const typeId of [
          ...new Set([
            ...types.map((t) => t.id),
            ...Object.keys(templates.entity_types ?? {}),
            ...Object.keys(previous?.entity_types ?? {}),
          ]),
        ].sort()
      ) {
        const changed = JSON.stringify(effectiveEntityTemplates(previous, typeId)) !==
          JSON.stringify(effectiveEntityTemplates(templates, typeId));
        const definition = await loadEntityDefinition(this.tx, typeId, changed);
        if (!definition) throw invalidInput("템플릿의 자료 종류가 없거나 접근할 수 없습니다");
        assertSchemaTemplateReferences(definition, templates, typeId);
      }
    }
    // Lock even the absent initial row; concurrent first saves cannot silently overwrite.
    await this.tx`select pg_advisory_xact_lock(hashtextextended(${`${this.actor.userId}:${id}`},0))`;
    const current = await this.get();
    if (current.versions[id] !== expected) {
      throw conflict("같은 설정에 다른 변경이 저장되어 있습니다. 최신값을 확인한 뒤 다시 저장하세요.");
    }
    await this
      .tx`insert into app.user_business_settings(owner_id,id,version,settings) values (${this.actor.userId},${id},${
      expected + 1
    },${
      this.tx.json(value as never)
    }) on conflict(owner_id,id) do update set version=excluded.version,settings=excluded.settings,updated_at=now()`;
    return this.get();
  }
  async recordTags(ids: string[]): Promise<string[]> {
    if (!ids.length) return [];
    const rows = await this.tx`select id from app.tags where scope='record' and id=any(${ids}::text[])`;
    return rows.map((row) => row.id as string);
  }
  async target(model: TemplateModel, id: string) {
    const table = model === "entity" ? "entities" : model === "task" ? "tasks" : "principles";
    const [row] = model === "entity"
      ? await this
        .tx`select e.*,t.id as type_id,v.schema->>'title' as label,v.schema->>'x-icon' as icon_id,coalesce((v.schema->>'deprecated')::boolean,false) as archived,t.schema_version as current_schema_version,v.schema from app.entities e
        join app.entity_types t on t.owner_id=e.owner_id and t.id=e.entity_type_id
        join app.entity_schema_versions v on v.owner_id=t.owner_id and v.type_id=t.id and v.schema_version=t.schema_version where e.id=${id}`
      : await this.tx`select * from app.${this.tx(table)} where id=${id}`;
    if (!row) return null;
    if (model === "principle" && !row.is_current) return null;
    const facts = model === "entity"
      ? {
        source: row.source,
        external_id: row.external_id,
        entity_type_id: row.entity_type_id,
        schema_version: Number(row.schema_version),
        properties: row.properties,
        title: entityPresentationRow(row, row.properties).title,
      }
      : Object.fromEntries(
        Object.values(templateFields[model]).map(
          (field) => [field, row[field] instanceof Date ? row[field].toISOString().slice(0, 10) : row[field]],
        ),
      );
    if (model !== "principle") {
      const tags = await this.tx`select tag_id from ${this.tx(`app.${model}_tags`)} where ${
        this.tx(`${model}_id`)
      }=${id}`;
      facts.tag_ids = tags.map((tag) => tag.tag_id);
    }
    return { version: Number(row.version), facts: facts as ChangeFacts, deleted_at: row.deleted_at };
  }
}
export class SqlBusinessSettingsUnitOfWork {
  constructor(private readonly sql: postgres.Sql) {}
  run<T>(actor: Actor, fn: (store: BusinessSettingsStore) => Promise<T>): Promise<T> {
    return runAsActor(this.sql, actor, (tx) => fn(new SqlBusinessSettingsStore(tx, actor)));
  }
}

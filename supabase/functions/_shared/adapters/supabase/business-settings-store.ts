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
import { conflict } from "../../core/shared/errors.ts";
import { runAsActor } from "./sql-context.ts";
import { templateFields, type TemplateModel } from "../../contracts/record-template.ts";
import type { ChangeFacts } from "../../core/shared/changes.ts";
import { entityPresentation, loadEntityDefinition } from "./entity-values.ts";

export class SqlBusinessSettingsStore implements BusinessSettingsStore {
  constructor(private readonly tx: postgres.TransactionSql, private readonly actor: Actor) {}
  definition(typeId: string, lock = false) { return loadEntityDefinition(this.tx,typeId,lock); }
  executeRequest<T>(request: RequestIdentity, execute: () => Promise<T>): Promise<T> {
    return executeSqlRequest(this.tx, this.actor, request, execute);
  }
  async get(): Promise<BusinessSettingsResult> {
    const rows = await this
      .tx`select id,version,settings from app.user_business_settings where owner_id=${this.actor.userId}`;
    const versions = { record_templates: 0, entity_identity: 0 };
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
    const [row] = await this.tx`select * from app.${this.tx(table)} where id=${id}`;
    if (!row) return null;
    if (model === "principle" && !row.is_current) return null;
    const facts = model === "entity" ? { source:row.source,external_id:row.external_id,entity_type_id:row.entity_type_id,
      schema_version:Number(row.schema_version),properties:row.properties,
      title:(await entityPresentation(this.tx,row.entity_type_id,Number(row.schema_version),row.properties)).title } : Object.fromEntries(
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

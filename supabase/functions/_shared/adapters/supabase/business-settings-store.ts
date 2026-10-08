import type postgres from "postgres";
import type { BusinessSettings, BusinessSettingsResult } from "../../contracts/business-settings.ts";
import type { Actor } from "../../core/shared/actor.ts";
import type { BusinessSettingsStore } from "../../core/settings/application.ts";
import { conflict } from "../../core/shared/errors.ts";
import { runAsActor } from "./sql-context.ts";
import { templateFields, type TemplateModel } from "../../contracts/record-template.ts";
import type { ChangeFacts } from "../../core/shared/changes.ts";

export class SqlBusinessSettingsStore implements BusinessSettingsStore {
  constructor(private readonly tx: postgres.TransactionSql, private readonly actor: Actor) {}
  async get(): Promise<BusinessSettingsResult> {
    const [row] = await this
      .tx`select version,settings from app.user_business_settings where owner_id=${this.actor.userId}`;
    return row
      ? { version: Number(row.version), settings: row.settings as BusinessSettings }
      : { version: 0, settings: {} };
  }
  async update(expected: number, sections: BusinessSettings): Promise<BusinessSettingsResult> {
    // Lock even the absent initial row; concurrent first saves cannot silently overwrite.
    await this.tx`select pg_advisory_xact_lock(hashtextextended(${this.actor.userId},0))`;
    const current = await this.get();
    if (current.version !== expected) {
      throw conflict("다른 설정이 저장되어 있습니다. 다시 조회한 뒤 변경을 적용하세요.");
    }
    const settings = { ...current.settings, ...sections };
    await this.tx`insert into app.user_business_settings(owner_id,version,settings) values (${this.actor.userId},${
      expected + 1
    },${
      this.tx.json(settings as never)
    }) on conflict(owner_id) do update set version=excluded.version,settings=excluded.settings,updated_at=now()`;
    return { version: expected + 1, settings };
  }
  async recordTags(ids: string[]): Promise<string[]> {
    if (!ids.length) return [];
    const rows = await this.tx`select id from app.tags where scope='record' and id=any(${ids}::uuid[])`;
    return rows.map((row) => row.id as string);
  }
  async target(model: TemplateModel, id: string) {
    const table = model === "entity" ? "entities" : model === "task" ? "tasks" : "principles";
    const [row] = await this.tx`select * from app.${this.tx(table)} where id=${id}`;
    if (!row) return null;
    const facts = Object.fromEntries(
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
    return { version: Number(row.version), facts: facts as ChangeFacts };
  }
}
export class SqlBusinessSettingsUnitOfWork {
  constructor(private readonly sql: postgres.Sql) {}
  run<T>(actor: Actor, fn: (store: BusinessSettingsStore) => Promise<T>): Promise<T> {
    return runAsActor(this.sql, actor, (tx) => fn(new SqlBusinessSettingsStore(tx, actor)));
  }
}

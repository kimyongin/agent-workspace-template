import { loadEntityDefinition } from "./entity-values.ts";
import type postgres from "postgres";
import type { EntityContext } from "../../contracts/entity-links.ts";
import type { ChangeInput } from "../../core/shared/changes.ts";
import { AppError } from "../../core/shared/errors.ts";

/** Actor-scoped selection storage and deletion effects share the caller's transaction. */
export class SqlEntityLinks {
  constructor(private readonly tx: postgres.TransactionSql) {}

  /** All old/new/inherited membership types are locked before any task/record row. */
  async prepareSelection(ids: string[] = [], taskId?: string, recordId?: string) {
    const rows = await this.tx<
      { entity_type_id: string }[]
    >`select distinct e.entity_type_id from app.entities e where e.id=any(${ids}::text[]) or e.id in (
      select unnest(t.entity_ids) from app.tasks t where t.id=${taskId ?? null} or t.result_record_id=${
      recordId ?? null
    }
      union select unnest(r.entity_ids) from app.records r where r.id=${recordId ?? null} or r.task_id=${taskId ?? null}
      union select unnest(t.entity_ids) from app.tasks t join app.records r on r.task_id=t.id where r.id=${
      recordId ?? null
    })`;
    for (const typeId of rows.map((r) => r.entity_type_id).sort()) await loadEntityDefinition(this.tx, typeId, true);
  }

  async taskSelection(ids?: string[], existingTaskId?: string) {
    if (ids === undefined) return {};
    await this.prepareSelection(ids, existingTaskId);
    const [prior] = existingTaskId === undefined ? [] : await this.tx<
      { entity_context: EntityContext[] }[]
    >`select entity_context from app.tasks where id=${existingTaskId}`;
    return this.fields(ids, await this.capture(ids, prior?.entity_context ?? []));
  }

  async recordSelection(ids?: string[], existingRecordId?: string, inheritedTaskId?: string) {
    if (ids === undefined) return {};
    await this.prepareSelection(ids, inheritedTaskId, existingRecordId);
    const [prior] = existingRecordId === undefined ? [] : await this.tx<{ entity_context: EntityContext[] }[]>`
        select entity_context from app.records where id=${existingRecordId}`;
    const [task] = inheritedTaskId === undefined ? [] : await this.tx<
      { entity_context: EntityContext[] }[]
    >`select entity_context from app.tasks where id=${inheritedTaskId}`;
    return this.fields(ids, await this.capture(ids, prior?.entity_context ?? task?.entity_context ?? []));
  }

  async changeSelection(input: Pick<ChangeInput, "target_kind" | "target" | "action">) {
    const target = input.target;

    const context = input.target_kind === "entity"
      ? target.entity_context.length ? target.entity_context : [{
        id: target.id,
        title: target.title,
        captured_at: new Date().toISOString(),
        source: "selection" as const,
      }]
      : await this.capture(target.entity_ids, target.entity_context);
    return this.fields(target.entity_ids, context);
  }

  private fields(ids: string[], context: EntityContext[]) {
    return { entity_ids: this.tx.array(ids, 25), entity_context: this.tx.json(context) };
  }

  /** Only trusted prior context loaded from a record/event may retain a deleted target. */
  private async capture(ids: string[], prior: EntityContext[] = []) {
    if (!ids.length) return [];
    const uncaptured = ids.filter((id) => !prior.some((p) => p.id === id));
    const live = uncaptured.length
      ? await this.tx<
        {
          id: string;
          title: string;
          captured_at: Date;
          type_id: string;
          label: string;
          icon_id: string;
          archived: boolean;
          schema_version: number;
        }[]
      >`select e.id,e.properties->>(select key from jsonb_each(v.schema->'properties') where value->>'x-representative'='true' limit 1) as title,now() as captured_at,t.id as type_id,v.schema->>'title' as label,v.schema->>'x-icon' as icon_id,coalesce((v.schema->>'deprecated')::boolean,false) as archived,t.schema_version from app.entities e
      join app.entity_types t on t.owner_id=e.owner_id and t.id=e.entity_type_id
      join app.entity_schema_versions v on v.owner_id=t.owner_id and v.type_id=t.id and v.schema_version=t.schema_version
      where e.deleted_at is null and not coalesce((v.schema->>'deprecated')::boolean,false) and e.id in ${
        this.tx(uncaptured)
      } order by e.id for key share of e`
      : [];
    return ids.map((id) => {
      const captured = prior.find((entity) => entity.id === id);
      const entity = live.find((entity) => entity.id === id);
      if (!entity && !captured) throw new AppError("invalid_reference", "엔터티가 없거나 접근할 수 없습니다");
      return captured ??
        {
          id,
          title: entity!.title,
          type: { id: entity!.type_id, label: entity!.label, icon_id: entity!.icon_id, archived: entity!.archived },
          schema_version: Number(entity!.schema_version),
          captured_at: entity!.captured_at.toISOString(),
          source: "selection" as const,
        };
    });
  }
}

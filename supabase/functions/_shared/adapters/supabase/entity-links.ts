import type postgres from "postgres";
import type { EntityContext } from "../../contracts/entity-links.ts";
import type { ChangeInput } from "../../core/shared/changes.ts";
import { AppError } from "../../core/shared/errors.ts";

/** Actor-scoped selection storage and deletion effects share the caller's transaction. */
export class SqlEntityLinks {
  constructor(private readonly tx: postgres.TransactionSql) {}

  async taskSelection(ids?: string[], existingTaskId?: string) {
    if (ids === undefined) return {};
    const [prior] = existingTaskId === undefined ? [] : await this.tx<
      { entity_context: EntityContext[] }[]
    >`select entity_context from app.tasks where id=${existingTaskId}`;
    return this.fields(ids, await this.capture(ids, prior?.entity_context ?? []));
  }

  async recordSelection(ids?: string[], existingRecordId?: string, inheritedTaskId?: string) {
    if (ids === undefined) return {};
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
      ? [{
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
    const live = await this.tx<
      { id: string; prop1: string; captured_at: Date }[]
    >`select id,prop1,now() as captured_at from app.entities where deleted_at is null and id in ${
      this.tx(ids)
    } order by id for key share`;
    return ids.map((id) => {
      const captured = prior.find((entity) => entity.id === id);
      const entity = live.find((entity) => entity.id === id);
      if (!entity && !captured) throw new AppError("invalid_reference", "엔터티가 없거나 접근할 수 없습니다");
      return captured ??
        { id, title: entity!.prop1, captured_at: entity!.captured_at.toISOString(), source: "selection" as const };
    });
  }
}

import type postgres from "postgres";
import type { Actor } from "../../core/shared/actor.ts";
import type { Task } from "../../core/activity/domain.ts";
import type { ActivityRecord } from "../../core/activity/ports.ts";
import { requireWorkspaceActor } from "./workspace-context.ts";
import { tagIdsColumn } from "./tag-links.ts";

/** Mutation-only saved-target projection. Classification never reads linked
 * entity captures or automatic-record historical display metadata. */
export class SqlTagTargets {
  constructor(private readonly tx: postgres.TransactionSql, private readonly actor: Actor) {}
  async task(id: string, touch = false): Promise<Task | null> {
    const [row] = await this.tx`select app.workspace_task_tag_target(${id},${touch}) as target`;
    return row.target ? { ...row.target, entity_ids: [], entity_context: [] } as Task : null;
  }
  async record(id: string, lock = false): Promise<ActivityRecord | null> {
    const workspace = requireWorkspaceActor(this.actor).workspaceId;
    if (lock) await this.tx`select id from app.records where workspace_id=${workspace} and id=${id} for update`;
    const [row] = await this.tx`select id,body,record_kind,occurred_at,task_id,occurrence_on::text as occurrence_on,
      version,created_at,updated_at,${
      tagIdsColumn(this.tx, "record")
    } from app.records where workspace_id=${workspace} and id=${id}`;
    return row
      ? {
        id: String(row.id),
        body: String(row.body),
        record_kind: row.record_kind as ActivityRecord["record_kind"],
        occurred_at: (row.occurred_at as Date).toISOString(),
        task_id: row.task_id as string | null,
        occurrence_on: row.occurrence_on as string | null,
        version: Number(row.version),
        created_at: (row.created_at as Date).toISOString(),
        updated_at: (row.updated_at as Date).toISOString(),
        tag_ids: row.tag_ids as string[],
        change: null,
        entity_ids: [],
        entity_context: [],
      }
      : null;
  }
}

import { authorizeWorkspace, requireWorkspaceActor, runInWorkspace } from "./workspace-context.ts";
import { invalidInput, notFound } from "../../core/shared/errors.ts";
import type { TagConnectionInput } from "../../contracts/tag-connection.ts";
import type { TagEntry } from "../../core/tags/application.ts";
import { loadEntityDefinition } from "./entity-values.ts";
import { insertWithIdRetry } from "./data-id.ts";
import type postgres from "postgres";
import type { TagResult } from "../../contracts/tag.ts";
import type { TagStore, TagUse } from "../../core/tags/application.ts";
import type { Actor } from "../../core/shared/actor.ts";
import type { Keyset } from "../../core/shared/store.ts";
import { conflict } from "../../core/shared/errors.ts";
import { SqlActorStore } from "./sql-context.ts";
import { SqlEntityStore } from "./entity-store.ts";
import { SqlActivityStore } from "./activity-store.ts";
const toTag = (r: Record<string, unknown>): TagResult => ({
  scope: r.scope as TagResult["scope"],
  id: r.id as string,
  name: r.name as string,
  version: r.version as number,
  created_at: (r.created_at as Date).toISOString(),
  updated_at: (r.updated_at as Date).toISOString(),
});
class SqlTagStore extends SqlActorStore implements TagStore {
  private get workspaceId() {
    return requireWorkspaceActor(this.actor).workspaceId;
  }
  async connectionTarget(input: TagConnectionInput): Promise<TagUse | null> {
    if (input.target_kind !== "entity") throw invalidInput("지원하지 않는 태그 연결 대상입니다");
    const value = await new SqlEntityStore(this.tx, this.actor).get(input.target_id, true);
    return value ? { kind: "entity", value } : null;
  }
  private deletionTypes: Set<string> | undefined;
  private async deletionTypeIds(id: string) {
    const rows = await this.tx<
      { entity_type_id: string }[]
    >`select distinct e.entity_type_id from app.entities e where e.id in (
      select entity_id from app.entity_tags where tag_id=${id}
      union select unnest(t.entity_ids) from app.tasks t join app.task_tags l on l.task_id=t.id where l.tag_id=${id}
      union select unnest(r.entity_ids) from app.records r join app.record_tags l on l.record_id=r.id where l.tag_id=${id})`;
    return rows.map((r) => r.entity_type_id).sort();
  }
  async prepareDelete(id: string) {
    this.deletionTypes = new Set(await this.deletionTypeIds(id));
    for (const typeId of this.deletionTypes) await loadEntityDefinition(this.tx, typeId, true);
  }
  async get(id: string, lock = false) {
    const [r] = await this.tx`select * from app.tags where workspace_id=${this.workspaceId} and id=${id} ${
      lock ? this.tx`for update` : this.tx``
    }`;
    if (lock && this.deletionTypes && (await this.deletionTypeIds(id)).some((type) => !this.deletionTypes!.has(type))) {
      throw conflict("태그 연결이 변경되었습니다. 최신 상태에서 다시 삭제하세요");
    }
    return r ? toTag(r) : null;
  }
  async unique(fn: () => Promise<Record<string, unknown>[]>) {
    try {
      return toTag((await fn())[0]);
    } catch (e) {
      if ((e as { code?: string }).code === "23505") throw conflict("같은 ID 또는 이름의 태그가 있습니다");
      throw e;
    }
  }
  async insert(name: string, scope: TagResult["scope"]) {
    return toTag(
      await insertWithIdRetry(() =>
        this.tx`insert into app.tags(workspace_id,name,scope) values (${this.workspaceId},${name},${scope})
      on conflict (id) do nothing returning *`
      ),
    );
  }
  rename(id: string, name: string) {
    return this.unique(() =>
      this
        .tx`update app.tags set name=${name},version=version+1,updated_at=now() where workspace_id=${this.workspaceId} and id=${id} returning *`
    );
  }
  async *uses(id: string): AsyncIterable<TagUse> {
    const entities = new SqlEntityStore(this.tx, this.actor), activity = new SqlActivityStore(this.tx, this.actor);
    for (const row of await this.tx`select entity_id id from app.entity_tags where tag_id=${id} order by entity_id`) {
      const value = await entities.get(row.id as string, true);
      if (value) yield { kind: "entity", value };
    }
    for (const row of await this.tx`select task_id id from app.task_tags where tag_id=${id} order by task_id`) {
      const value = await activity.getTask(row.id as string, { forUpdate: true });
      if (value) yield { kind: "task", value };
    }
    for (const row of await this.tx`select record_id id from app.record_tags where tag_id=${id} order by record_id`) {
      const value = await activity.getRecord(row.id as string, { forUpdate: true });
      if (value) yield { kind: "record", value };
    }
  }
  async setTags(use: TagUse, tag_ids: string[]): Promise<TagUse> {
    if (use.kind === "entity") {
      const entities = new SqlEntityStore(this.tx, this.actor);
      return {
        kind: "entity",
        value: await entities.setTags(use.value.id, tag_ids),
      };
    }
    const activity = new SqlActivityStore(this.tx, this.actor);
    if (use.kind === "task") return { kind: "task", value: await activity.updateTask(use.value.id, { tag_ids }) };
    return { kind: "record", value: await activity.updateRecord(use.value.id, { tag_ids }) };
  }
  async delete(id: string) {
    await this.tx`delete from app.tags where workspace_id=${this.workspaceId} and id=${id}`;
  }
  async listRecordTemplateTags(limit: number, after?: Keyset) {
    const rows = await this.tx`select * from app.workspace_record_template_tags(${limit},${
      after?.at ?? null
    }::timestamptz,${after?.id ?? null}::text)`;
    return rows.map(toTag);
  }
  async list(limit: number, after?: Keyset, scope: TagResult["scope"] = "record") {
    const tx = this.tx;
    return (await tx`select * from app.tags where workspace_id=${this.workspaceId} and scope=${scope} ${
      after ? tx`and (updated_at,id)<(${after.at}::timestamptz,${after.id}::text)` : tx``
    } order by updated_at desc,id desc limit ${limit}`).map(toTag);
  }
}
export class SqlTagUnitOfWork {
  constructor(private readonly sql: postgres.Sql) {}
  run<T>(a: Actor, fn: (s: TagStore) => Promise<T>, entry?: TagEntry): Promise<T> {
    const actor = requireWorkspaceActor(a);
    return runInWorkspace(this.sql, actor, { mode: "business", requirements: [] }, async (tx) => {
      if (entry?.connection) {
        if (entry.connection.target_kind !== "entity") {
          throw invalidInput("지원하지 않는 태그 연결 대상입니다");
        }
        const [entity] =
          await tx`select entity_type_id from app.entities where workspace_id=${actor.workspaceId} and id=${entry.connection.target_id}`;
        if (!entity) throw notFound();
        const requirements = [{
          target_kind: "entity_type" as const,
          target_id: String(entity.entity_type_id),
          access: "write" as const,
        }];
        await authorizeWorkspace(tx, requirements);
        await tx`select set_config('request.workspace_requirements',${JSON.stringify(requirements)},true)`;
      }
      return fn(new SqlTagStore(tx, a));
    });
  }
}

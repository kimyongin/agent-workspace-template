import type postgres from "postgres";
import type { TagResult } from "../../contracts/tag.ts";
import type { TagStore, TagUse } from "../../core/tags/application.ts";
import type { Actor } from "../../core/shared/actor.ts";
import type { Keyset } from "../../core/shared/store.ts";
import { conflict } from "../../core/shared/errors.ts";
import { runAsActor, SqlActorStore } from "./sql-context.ts";
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
  async get(id: string, lock = false) {
    const [r] = await this.tx`select * from app.tags where id=${id} ${lock ? this.tx`for update` : this.tx``}`;
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
  insert(id: string, name: string, scope: TagResult["scope"]) {
    return this.unique(() =>
      this
        .tx`insert into app.tags(id,owner_id,name,scope) values (${id},${this.actor.userId},${name},${scope}) returning *`
    );
  }
  rename(id: string, name: string) {
    return this.unique(() =>
      this.tx`update app.tags set name=${name},version=version+1,updated_at=now() where id=${id} returning *`
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
      return { kind: "entity", value: await new SqlEntityStore(this.tx, this.actor).update(use.value.id, { tag_ids }) };
    }
    const activity = new SqlActivityStore(this.tx, this.actor);
    if (use.kind === "task") return { kind: "task", value: await activity.updateTask(use.value.id, { tag_ids }) };
    return { kind: "record", value: await activity.updateRecord(use.value.id, { tag_ids }) };
  }
  async delete(id: string) {
    await this.tx`delete from app.tags where id=${id}`;
  }
  async list(limit: number, after?: Keyset, scope: TagResult["scope"] = "record") {
    const tx = this.tx;
    return (await tx`select * from app.tags where scope=${scope} ${
      after ? tx`and (updated_at,id)<(${after.at}::timestamptz,${after.id}::uuid)` : tx``
    } order by updated_at desc,id desc limit ${limit}`).map(toTag);
  }
}
export class SqlTagUnitOfWork {
  constructor(private readonly sql: postgres.Sql) {}
  run<T>(a: Actor, fn: (s: TagStore) => Promise<T>): Promise<T> {
    return runAsActor(this.sql, a, (tx) => fn(new SqlTagStore(tx, a)));
  }
}

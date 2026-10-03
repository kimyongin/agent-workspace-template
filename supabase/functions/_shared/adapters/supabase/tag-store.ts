import type postgres from "postgres";
import type { TagResult } from "../../contracts/tag.ts";
import type { TagStore } from "../../core/tags/application.ts";
import type { Actor } from "../../core/shared/actor.ts";
import type { Keyset } from "../../core/shared/store.ts";
import { conflict } from "../../core/shared/errors.ts";
import { runAsActor, SqlActorStore } from "./sql-context.ts";
const toTag = (r: Record<string, unknown>): TagResult => ({
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
      if ((e as { code?: string }).code === "23505") throw conflict("같은 이름의 태그가 있습니다");
      throw e;
    }
  }
  insert(name: string) {
    return this.unique(() =>
      this.tx`insert into app.tags(owner_id,name) values (${this.actor.userId},${name}) returning *`
    );
  }
  rename(id: string, name: string) {
    return this.unique(() =>
      this.tx`update app.tags set name=${name},version=version+1,updated_at=now() where id=${id} returning *`
    );
  }
  async delete(id: string) {
    await this
      .tx`update app.tasks set version=version+1,updated_at=now() where id in(select task_id from app.task_tags where tag_id=${id})`;
    await this
      .tx`update app.records set version=version+1,updated_at=now() where id in(select record_id from app.record_tags where tag_id=${id})`;
    await this
      .tx`update app.principles set version=version+1,updated_at=now() where id in(select principle_id from app.principle_tags where tag_id=${id})`;
    await this.tx`delete from app.tags where id=${id}`;
  }
  async list(limit: number, after?: Keyset) {
    const tx = this.tx;
    return (await tx`select * from app.tags ${
      after ? tx`where (updated_at,id)<(${after.at}::timestamptz,${after.id}::uuid)` : tx``
    } order by updated_at desc,id desc limit ${limit}`).map(toTag);
  }
}
export class SqlTagUnitOfWork {
  constructor(private readonly sql: postgres.Sql) {}
  run<T>(a: Actor, fn: (s: TagStore) => Promise<T>): Promise<T> {
    return runAsActor(this.sql, a, (tx) => fn(new SqlTagStore(tx, a)));
  }
}

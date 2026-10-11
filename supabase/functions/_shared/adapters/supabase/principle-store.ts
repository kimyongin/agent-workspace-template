import type postgres from "postgres";
import type { PrincipleCreate, PrincipleResult } from "../../contracts/principle.ts";
import type { PrincipleStore, PrincipleUnitOfWork } from "../../core/principles/ports.ts";
import type { Actor } from "../../core/shared/actor.ts";
import { runAsActor, SqlActorStore } from "./sql-context.ts";
function result(r: Record<string, unknown>): PrincipleResult {
  return {
    id: r.id as string,
    title: r.title as string,
    body: r.body as string,
    is_current: r.is_current as boolean,
    saved_at: (r.saved_at as Date).toISOString(),
    origin: r.origin as PrincipleResult["origin"],
    legacy_context: r.legacy_context as PrincipleResult["legacy_context"],
    version: r.version as number,
    created_at: (r.created_at as Date).toISOString(),
    updated_at: (r.updated_at as Date).toISOString(),
  };
}
class SqlPrincipleStore extends SqlActorStore implements PrincipleStore {
  private async lockCurrent() {
    await this.tx`select pg_advisory_xact_lock(hashtextextended(${`${this.actor.userId}:current_principle`},0))`;
  }
  async current(options?: { forUpdate?: boolean }) {
    if (options?.forUpdate) await this.lockCurrent();
    const [r] = await this.tx`select * from app.principles where is_current ${
      options?.forUpdate ? this.tx`for update` : this.tx``
    }`;
    return r ? result(r) : null;
  }
  async insert(i: PrincipleCreate) {
    const [r] = await this.tx`insert into app.principles(owner_id,title,body,is_current,version)
    values(${this.actor.userId},${i.title},${i.body},true,1) returning *`;
    return result(r);
  }
  async get(id: string) {
    const [r] = await this.tx`select * from app.principles where id=${id} and is_current`;
    return r ? result(r) : null;
  }
  async update(id: string, i: Parameters<PrincipleStore["update"]>[1]) {
    const values = Object.fromEntries(Object.entries(i).filter(([, v]) => v !== undefined));
    const [r] = await this.tx`update app.principles set ${
      this.tx(values)
    },version=version+1,updated_at=now(),saved_at=case when is_current then clock_timestamp() else saved_at end where id=${id} and is_current returning *`;
    return result(r);
  }
  async delete(id: string) {
    await this.tx`delete from app.principles where id=${id} and is_current`;
  }
}
export class SqlPrincipleUnitOfWork implements PrincipleUnitOfWork {
  constructor(private readonly sql: postgres.Sql) {}
  run<T>(a: Actor, fn: (s: PrincipleStore) => Promise<T>): Promise<T> {
    return runAsActor(this.sql, a, (tx) => fn(new SqlPrincipleStore(tx, a)));
  }
}

import type postgres from "postgres";
import type { PrincipleCreate, PrincipleResult } from "../../contracts/principle.ts";
import type { PrincipleStore, PrincipleUnitOfWork } from "../../core/principles/ports.ts";
import type { Actor } from "../../core/shared/actor.ts";
import { runAsActor, SqlActorStore } from "./sql-context.ts";
function result(r: Record<string, unknown>): PrincipleResult {
  return {
    id: r.id as string,
    title: r.title as string,
    summary: r.summary as string,
    body: r.body as string,
    is_current: r.is_current as boolean,
    saved_at: (r.saved_at as Date).toISOString(),
    change_note: r.change_note as string | null,
    origin: r.origin as PrincipleResult["origin"],
    legacy_context: r.legacy_context as PrincipleResult["legacy_context"],
    entity_id: null,
    tag_ids: [],
    applies_when: "",
    status: r.is_current ? "active" : "inactive",
    replaced_by_id: null,
    version: r.version as number,
    created_at: (r.created_at as Date).toISOString(),
    updated_at: (r.updated_at as Date).toISOString(),
  };
}
class SqlPrincipleStore extends SqlActorStore implements PrincipleStore {
  async lockCurrent() {
    await this.tx`select pg_advisory_xact_lock(hashtextextended(${`${this.actor.userId}:current_principle`},0))`;
  }
  async nextVersion() {
    const [r] = await this.tx`insert into app.principle_versions(owner_id,version)
      values(${this.actor.userId},coalesce((select max(version) from app.principles),0)+1)
      on conflict(owner_id) do update set version=greatest(app.principle_versions.version,
        coalesce((select max(version) from app.principles),0))+1 returning version`;
    return r.version as number;
  }
  async current() {
    const [r] = await this.tx`select * from app.principles where is_current`;
    return r ? result(r) : null;
  }
  async insert(i: Omit<PrincipleCreate, "request_id">, version = 1) {
    const [r] = await this.tx`insert into app.principles(owner_id,title,summary,body,is_current,change_note,version)
    values(${this.actor.userId},${i.title},${i.summary},${i.body},true,${
      i.change_note ?? null
    },${version}) returning *`;
    return result(r);
  }
  async get(id: string, lock = false) {
    const [r] = await this.tx`select * from app.principles where id=${id} ${lock ? this.tx`for update` : this.tx``}`;
    return r ? result(r) : null;
  }
  async retire(id: string) {
    await this.tx`update app.principles set is_current=false where id=${id}`;
  }
  async update(id: string, i: Parameters<PrincipleStore["update"]>[1], version?: number) {
    const values = Object.fromEntries(Object.entries(i).filter(([, v]) => v !== undefined));
    const [r] = await this.tx`update app.principles set ${this.tx(values)},version=${
      version ?? this.tx`version+1`
    },updated_at=now(),saved_at=case when is_current then clock_timestamp() else saved_at end where id=${id} returning *`;
    return result(r);
  }
  async delete(id: string) {
    await this.tx`update app.principles set replaced_by_id=null where replaced_by_id=${id}`;
    await this.tx`delete from app.principles where id=${id}`;
  }
  async promoteLatest(version: number) {
    await this
      .tx`update app.principles set is_current=true,version=${version} where id=(select id from app.principles order by saved_at desc,id desc limit 1)`;
  }
  async list(f: Parameters<PrincipleStore["list"]>[0]) {
    const tx = this.tx;
    return (await tx`select * from app.principles where true
    ${f.view === "current" ? tx`and is_current` : f.view === "history" ? tx`and not is_current` : tx``}
    ${
      f.after
        ? tx`and (saved_at,id)<(${f.after.at}::timestamptz,${f.after.id}::uuid)`
        : tx``
    } order by saved_at desc,id desc limit ${f.limit}`).map(result);
  }
}
export class SqlPrincipleUnitOfWork implements PrincipleUnitOfWork {
  constructor(private readonly sql: postgres.Sql) {}
  run<T>(a: Actor, fn: (s: PrincipleStore) => Promise<T>): Promise<T> {
    return runAsActor(this.sql, a, (tx) => fn(new SqlPrincipleStore(tx, a)));
  }
}

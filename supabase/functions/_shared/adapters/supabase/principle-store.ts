import type postgres from "postgres";
import type { PrincipleCreate, PrincipleResult } from "../../contracts/principle.ts";
import type { PrincipleStore, PrincipleUnitOfWork } from "../../core/principles/ports.ts";
import type { Actor } from "../../core/shared/actor.ts";
import { runAsActor, SqlActorStore } from "./sql-context.ts";
import { hasTag, setTagLinks, tagIdsColumn } from "./tag-links.ts";
import { requireEntity } from "./entity-reference.ts";

type Row = Omit<PrincipleResult, "created_at" | "updated_at"> & { created_at: Date; updated_at: Date };
const result = (r: Row): PrincipleResult => ({
  ...r,
  created_at: r.created_at.toISOString(),
  updated_at: r.updated_at.toISOString(),
});
const columns = (tx: postgres.TransactionSql) =>
  tx`id, entity_id, title, summary, body, applies_when, status, replaced_by_id, version, created_at, updated_at,${
    tagIdsColumn(tx, "principle")
  }`;

class SqlPrincipleStore extends SqlActorStore implements PrincipleStore {
  async insert(input: Omit<PrincipleCreate, "request_id">) {
    await requireEntity(this.tx, input.entity_id);
    const [row] = await this.tx<
      Row[]
    >`insert into app.principles (owner_id, entity_id, title, summary, body, applies_when)
      values (${this.actor.userId}, ${
      input.entity_id ?? null
    }, ${input.title}, ${input.summary}, ${input.body}, ${input.applies_when})
      returning id`;
    await setTagLinks(this.tx, this.actor, "principle", row.id, input.tag_ids ?? []);
    return (await this.get(row.id))!;
  }
  async get(id: string, forUpdate = false) {
    const [row] = await this.tx<Row[]>`select ${columns(this.tx)} from app.principles where id = ${id} ${
      forUpdate ? this.tx`for update` : this.tx``
    }`;
    return row ? result(row) : null;
  }
  async update(id: string, changes: Parameters<PrincipleStore["update"]>[1]) {
    const tx = this.tx;
    await requireEntity(tx, changes.entity_id);
    const allowed = ["title", "summary", "body", "applies_when", "status", "replaced_by_id", "entity_id"];
    const values = Object.fromEntries(
      Object.entries(changes).filter(([k, v]) => allowed.includes(k) && v !== undefined),
    );
    if (changes.tag_ids !== undefined) await setTagLinks(tx, this.actor, "principle", id, changes.tag_ids);
    const [row] = Object.keys(values).length
      ? await tx<Row[]>`update app.principles set ${tx(values)}, version=version+1, updated_at=now()
      where id=${id} returning ${columns(tx)}`
      : await tx<Row[]>`update app.principles set version=version+1,updated_at=now() where id=${id} returning ${
        columns(tx)
      }`;
    return result(row);
  }
  async delete(id: string) {
    await this.tx`update app.principles set replaced_by_id=null, version=version+1, updated_at=now()
      where replaced_by_id=${id}`;
    await this.tx`update app.records set version=version+1, updated_at=now() where id in
      (select record_id from app.record_principles where principle_id=${id})`;
    await this.tx`delete from app.principles where id=${id}`;
  }
  async list(f: Parameters<PrincipleStore["list"]>[0]) {
    const tx = this.tx;
    const rows = await tx<Row[]>`select ${columns(tx)} from app.principles where status = ${f.status}
      ${f.entity_id ? tx`and entity_id=${f.entity_id}` : tx``}
      ${f.tag_id ? tx`and ${hasTag(tx, "principle", f.tag_id)}` : tx``}
      ${f.after ? tx`and (updated_at, id) < (${f.after.at}::timestamptz, ${f.after.id}::uuid)` : tx``}
      order by updated_at desc, id desc limit ${f.limit}`;
    return rows.map(result);
  }
}
export class SqlPrincipleUnitOfWork implements PrincipleUnitOfWork {
  constructor(private readonly sql: postgres.Sql) {}
  run<T>(actor: Actor, fn: (store: PrincipleStore) => Promise<T>): Promise<T> {
    return runAsActor(this.sql, actor, (tx) => fn(new SqlPrincipleStore(tx, actor)));
  }
}

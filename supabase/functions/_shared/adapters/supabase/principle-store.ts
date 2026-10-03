import type postgres from "postgres";
import type { PrincipleCreate, PrincipleResult } from "../../contracts/principle.ts";
import type { PrincipleStore, PrincipleUnitOfWork } from "../../core/principles/ports.ts";
import type { Actor } from "../../core/shared/actor.ts";
import { runAsActor, SqlActorStore } from "./sql-context.ts";

type Row = Omit<PrincipleResult, "created_at" | "updated_at"> & { created_at: Date; updated_at: Date };
const result = (r: Row): PrincipleResult => ({
  ...r,
  created_at: r.created_at.toISOString(),
  updated_at: r.updated_at.toISOString(),
});
const columns = "id, title, summary, body, applies_when, status, replaced_by_id, version, created_at, updated_at";

class SqlPrincipleStore extends SqlActorStore implements PrincipleStore {
  async insert(input: Omit<PrincipleCreate, "request_id">) {
    const [row] = await this.tx<Row[]>`insert into app.principles (owner_id, title, summary, body, applies_when)
      values (${this.actor.userId}, ${input.title}, ${input.summary}, ${input.body}, ${input.applies_when})
      returning ${this.tx.unsafe(columns)}`;
    return result(row);
  }
  async get(id: string) {
    const [row] = await this.tx<Row[]>`select ${this.tx.unsafe(columns)} from app.principles where id = ${id}`;
    return row ? result(row) : null;
  }
  async list(f: Parameters<PrincipleStore["list"]>[0]) {
    const tx = this.tx;
    const rows = await tx<Row[]>`select ${tx.unsafe(columns)} from app.principles where status = ${f.status}
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

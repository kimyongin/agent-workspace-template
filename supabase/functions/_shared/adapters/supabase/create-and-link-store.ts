import type { RelationEntry } from "../../core/entity-relations/links.ts";
import { authorizeRelation } from "./entity-relation-locks.ts";
import { requireWorkspaceActor, runInWorkspace } from "./workspace-context.ts";
import type postgres from "postgres";
import type { Actor } from "../../core/shared/actor.ts";
import type { CreateAndLinkStore } from "../../core/entity-relations/create-and-link.ts";
import type { CreateAndLinkInput } from "../../contracts/create-and-link.ts";
import type { EntityRelationDefinition } from "../../contracts/entity-relation.ts";
import { notFound } from "../../core/shared/errors.ts";
import { SqlEntityStore } from "./entity-store.ts";
import { SqlEntityRelationLinkStore } from "./entity-relation-link-store.ts";
import { loadBusinessEntityDefinition } from "./entity-values.ts";
import { SqlActorStore } from "./sql-context.ts";
export class SqlCreateAndLinkStore extends SqlActorStore implements CreateAndLinkStore {
  readonly entities: SqlEntityStore;
  readonly relations: SqlEntityRelationLinkStore;
  constructor(tx: postgres.TransactionSql, actor: Actor) {
    super(tx, actor);
    this.entities = new SqlEntityStore(tx, actor);
    this.relations = new SqlEntityRelationLinkStore(tx, actor);
  }
  async prepare(def: EntityRelationDefinition, i: CreateAndLinkInput) {
    for (const typeId of [...new Set(def.ends.map((e) => e.type_id))].sort()) {
      if (!await loadBusinessEntityDefinition(this.tx, typeId, true)) throw notFound();
    }
    const ids = [
      ...(i.entity.action === "restore" ? [i.entity.id] : []),
      i.origin_id,
      ...(i.previous_other_id ? [i.previous_other_id] : []),
    ];
    await this.relations.endpoints([...new Set(ids)], true);
  }
}
export class SqlCreateAndLinkUnitOfWork {
  constructor(private readonly sql: postgres.Sql) {}
  run<T>(actor: Actor, fn: (s: CreateAndLinkStore) => Promise<T>, entry?: RelationEntry) {
    return runInWorkspace(
      this.sql,
      requireWorkspaceActor(actor),
      { mode: "business", requirements: [] },
      async (tx) => {
        if (!entry) throw new Error("relation entry is required");
        await authorizeRelation(tx, actor, entry);
        return fn(new SqlCreateAndLinkStore(tx, actor));
      },
    );
  }
}

/** Test setup explicitly declares many↔many definitions before writing typed links.
 * This fixture convenience is not exposed by any product API. */
import type postgres from "postgres";
import { splitEntityId } from "../../functions/_shared/contracts/entity-identity.ts";
import type { Actor } from "../../functions/_shared/core/shared/actor.ts";
import { requestActor } from "../_request.ts";
import { SqlEntityRelationDefinitionUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-relation-definition-store.ts";
import { SqlEntityRelationLinkUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-relation-link-store.ts";
import { createEntityRelationDefinition } from "../../functions/_shared/core/entity-relations/application.ts";
import {
  connectEntityRelation,
  listEntityRelationLinks,
  unlinkEntityRelation,
} from "../../functions/_shared/core/entity-relations/links.ts";
import type { EntitySummary } from "../../functions/_shared/contracts/entity.ts";
export function configuredRelationFixture(sql: postgres.Sql) {
  return { sql, definitions: new Map<string, Awaited<ReturnType<typeof createEntityRelationDefinition>>>() };
}
type Fixture = ReturnType<typeof configuredRelationFixture>;
export async function changeConfiguredRelation(f: Fixture, actor: Actor, origin: string, input: {
  other_id: string;
  expected_version: number;
  expected_other_version: number;
  change_note?: string;
  change_tag_ids?: string[];
}, linked: boolean) {
  const kinds = [splitEntityId(origin).entity_type_id, splitEntityId(input.other_id).entity_type_id].sort();
  const key = `${actor.userId}:${kinds.join(":")}`;
  let def = f.definitions.get(key);
  if (!def) {
    def = await createEntityRelationDefinition(
      { uow: new SqlEntityRelationDefinitionUnitOfWork(f.sql) },
      requestActor(actor),
      {
        ends: [{ type_id: kinds[0], label: "시험 원점", cardinality: "many" }, {
          type_id: kinds[1],
          label: "시험 상대",
          cardinality: "many",
        }],
      },
    );
    f.definitions.set(key, def);
  }
  const side = splitEntityId(origin).entity_type_id === def.ends[0].type_id ? 0 : 1;
  return (linked ? connectEntityRelation : unlinkEntityRelation)(
    { uow: new SqlEntityRelationLinkUnitOfWork(f.sql) },
    actor,
    {
      ...input,
      definition_id: def.id,
      expected_definition_version: def.version,
      side,
      origin_id: origin,
    },
  );
}
export async function listConfiguredLinks(f: Fixture, actor: Actor, origin: string, _q: { limit: number }) {
  const kind = splitEntityId(origin).entity_type_id, items: EntitySummary[] = [];
  for (const def of f.definitions.values()) {
    for (const side of [0, 1] as const) {
      if (def.ends[side].type_id !== kind) continue;
      let cursor: string | undefined;
      do {
        const page = await listEntityRelationLinks({ uow: new SqlEntityRelationLinkUnitOfWork(f.sql) }, actor, {
          definition_id: def.id,
          origin_id: origin,
          side,
          limit: 100,
          cursor,
        });
        items.push(...page.items);
        cursor = page.next_cursor ?? undefined;
      } while (cursor);
    }
  }
  return { items: [...new Map(items.map((v) => [v.id, v])).values()], next_cursor: null };
}

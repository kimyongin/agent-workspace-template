import type postgres from "postgres";
import type { Actor } from "../../core/shared/actor.ts";
import { AppError } from "../../core/shared/errors.ts";
type Tx = postgres.TransactionSql;
type Kind = "task" | "record" | "principle" | "entity";
export function tagIdsColumn(tx: Tx, kind: Kind) {
  return tx`coalesce((select jsonb_agg(tag_id order by tag_id) from ${tx(`app.${kind}_tags`)}
    where ${tx(`${kind}_id`)}=${tx(`app.${kind === "entity" ? "entities" : `${kind}s`}.id`)}),'[]'::jsonb) as tag_ids`;
}
export function hasTag(tx: Tx, kind: Kind, id: string) {
  return tx`exists(select 1 from ${tx(`app.${kind}_tags`)} where ${tx(`${kind}_id`)}=${
    tx(`app.${kind === "entity" ? "entities" : `${kind}s`}.id`)
  } and tag_id=${id})`;
}
export function hasAnyTag(tx: Tx, kind: Kind, ids: string[]) {
  return tx`exists(select 1 from ${tx(`app.${kind}_tags`)} where ${tx(`${kind}_id`)}=${
    tx(`app.${kind === "entity" ? "entities" : `${kind}s`}.id`)
  } and tag_id in ${tx(ids)})`;
}
export async function setTagLinks(tx: Tx, actor: Actor, kind: Kind, itemId: string, ids: string[]) {
  if (ids.length) {
    const rows = await tx`select id from app.tags where id in ${tx(ids)} and scope=${
      kind === "entity" ? "entity" : "activity"
    } order by id for key share`;
    if (rows.length !== ids.length) throw new AppError("invalid_reference", "태그가 없거나 접근할 수 없습니다");
  }
  await tx`delete from ${tx(`app.${kind}_tags`)} where ${tx(`${kind}_id`)}=${itemId}`;
  for (const id of [...ids].sort()) {
    await tx`insert into ${tx(`app.${kind}_tags`)}(owner_id,${
      tx(`${kind}_id`)
    },tag_id) values (${actor.userId},${itemId},${id})`;
  }
}

import type postgres from "postgres";
import type { EntityContext } from "../../contracts/entity-links.ts";
import { AppError } from "../../core/shared/errors.ts";

/** Actor-scoped reads validate new selections; only trusted prior context may retain a deleted target. */
export async function captureEntities(tx: postgres.TransactionSql, ids: string[], prior: EntityContext[] = []) {
  if (!ids.length) return [];
  const live = await tx<
    { id: string; prop1: string; captured_at: Date }[]
  >`select id,prop1,now() as captured_at from app.entities where id in ${tx(ids)} order by id for key share`;
  return ids.map((id) => {
    const captured = prior.find((entity) => entity.id === id);
    const entity = live.find((entity) => entity.id === id);
    if (!entity && !captured) throw new AppError("invalid_reference", "엔터티가 없거나 접근할 수 없습니다");
    return captured ??
      { id, title: entity!.prop1, captured_at: entity!.captured_at.toISOString(), source: "selection" as const };
  });
}

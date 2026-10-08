import type postgres from "postgres";
import { AppError } from "../../core/shared/errors.ts";
export async function requireEntity(tx: postgres.TransactionSql, id: string | null | undefined) {
  if (!id) return;
  const [row] = await tx`select id from app.entities where id=${id} and deleted_at is null for key share`;
  if (!row) throw new AppError("invalid_reference", "엔터티가 없거나 접근할 수 없습니다");
}

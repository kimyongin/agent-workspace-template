import { AppError } from "../../core/shared/errors.ts";

/** The insert must ignore only its generated ID's PK conflict; other errors propagate. */
export async function insertWithIdRetry<T>(insert: () => Promise<T[]>): Promise<T> {
  for (let attempt = 0; attempt < 64; attempt++) {
    const [row] = await insert();
    if (row !== undefined) return row;
  }
  throw new AppError("unavailable", "ID 생성이 충돌했습니다. 같은 요청 키로 다시 시도하세요");
}

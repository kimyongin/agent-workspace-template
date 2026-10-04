import { z } from "zod";
import { expectedVersion } from "../../contracts/common.ts";
import { mutationMeta } from "../../contracts/change.ts";
import type { Actor } from "../../core/shared/actor.ts";
import { notFound } from "../../core/shared/errors.ts";

export type HttpEnv = { Variables: { actor: Actor } };
export function idParam(value: string): string {
  if (!z.uuid().safeParse(value).success) throw notFound();
  return value;
}
export async function json(req: Request): Promise<unknown> {
  if (!req.headers.get("content-type")?.includes("application/json")) return {};
  try {
    return await req.json();
  } catch {
    return Symbol("invalid json");
  }
}
/** HTTP query 값만 숫자로 바꾼다. JSON 본문의 버전은 숫자를 요구한다. */
export const versionQuery = z.strictObject({
  expected_version: z.coerce.number().pipe(expectedVersion),
  ...mutationMeta,
});

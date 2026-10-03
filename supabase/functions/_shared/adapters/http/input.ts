import { z } from "zod";
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

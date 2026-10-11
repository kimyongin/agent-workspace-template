import type { Actor } from "../functions/_shared/core/shared/actor.ts";
/** A fresh key denotes each independent fixture write. Replay tests supply their own fixed key. */
export function requestActor(actor: Actor): Actor {
  return { ...actor, request: { key: crypto.randomUUID() } };
}

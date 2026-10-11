import type { StatusData, StatusInput, StatusOverview } from "../../contracts/status.ts";
import type { Actor } from "../shared/actor.ts";

export interface StatusDeps {
  reader: { overview(actor: Actor, timezone: string, at: Date): Promise<StatusData> };
  clock: { now(): Date };
}
export async function getStatus(d: StatusDeps, actor: Actor, input: StatusInput): Promise<StatusOverview> {
  const at = d.clock.now();
  return {
    ...await d.reader.overview(actor, input.timezone, at),
    timezone: input.timezone,
    queried_at: at.toISOString(),
  };
}

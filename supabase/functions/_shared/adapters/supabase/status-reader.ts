import type postgres from "postgres";
import type { StatusData } from "../../contracts/status.ts";
import type { Actor } from "../../core/shared/actor.ts";
import { SEARCH_PIPELINE } from "../../core/search/config.ts";
import { runAsActor } from "./sql-context.ts";
export class SqlStatusReader {
  constructor(private readonly sql: postgres.Sql) {}
  overview(actor: Actor, timezone: string, at: Date): Promise<StatusData> {
    return runAsActor(this.sql, actor, async (tx) => {
      const [row] =
        await tx`select app.status_overview(${SEARCH_PIPELINE},${timezone},${at.toISOString()}::timestamptz) as overview`;
      return row.overview as StatusData;
    });
  }
}

import { recordDisplayText } from "../../contracts/record-display.ts";
import type postgres from "postgres";
import type { IndexingIssue, StatusData } from "../../contracts/status.ts";
import type { Actor } from "../../core/shared/actor.ts";
import { SEARCH_PIPELINE } from "../../core/search/config.ts";
import { runAsActor } from "./sql-context.ts";
import type { Keyset } from "../../core/shared/store.ts";
export class SqlStatusReader {
  constructor(private readonly sql: postgres.Sql) {}
  overview(actor: Actor, timezone: string, at: Date): Promise<StatusData> {
    return runAsActor(this.sql, actor, async (tx) => {
      const [row] = await tx`select
        app.status_overview(${SEARCH_PIPELINE},${timezone},${at.toISOString()}::timestamptz) as overview,
        app.status_indexing_wait(${SEARCH_PIPELINE},${at.toISOString()}::timestamptz) as waiting`;
      const overview = row.overview as StatusData;
      return { ...overview, indexing: { ...overview.indexing, waiting: row.waiting } };
    });
  }

  issues(actor: Actor, at: Date, after?: Keyset): Promise<IndexingIssue[]> {
    return runAsActor(this.sql, actor, async (tx) => {
      const rows =
        await tx`select issue from app.status_indexing_issues(${SEARCH_PIPELINE},${at.toISOString()}::timestamptz,
        ${after?.at ?? null}::timestamptz,${after?.id ?? null})`;
      return rows.map((row) => {
        const issue = row.issue as IndexingIssue;
        return { ...issue, title: recordDisplayText(issue.title) };
      });
    });
  }
}

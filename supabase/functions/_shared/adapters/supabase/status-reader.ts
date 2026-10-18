import { recordDisplayText } from "../../contracts/record-display.ts";
import type postgres from "postgres";
import type { IndexingIssue, StatusData } from "../../contracts/status.ts";
import type { Actor } from "../../core/shared/actor.ts";
import { SEARCH_PIPELINE } from "../../core/search/config.ts";
import { requireWorkspaceActor, runInWorkspace } from "./workspace-context.ts";
import type { Keyset } from "../../core/shared/store.ts";
export class SqlStatusReader {
  constructor(private readonly sql: postgres.Sql) {}
  overview(actor: Actor, timezone: string, at: Date): Promise<StatusData> {
    return runInWorkspace(
      this.sql,
      requireWorkspaceActor(actor),
      { mode: "business", requirements: [] },
      async (tx) => {
        const [row] =
          await tx`select app.status_overview(${SEARCH_PIPELINE},${timezone},${at.toISOString()}::timestamptz) as overview`;
        return row.overview as StatusData;
      },
    );
  }

  issues(actor: Actor, at: Date, after?: Keyset): Promise<IndexingIssue[]> {
    return runInWorkspace(
      this.sql,
      requireWorkspaceActor(actor),
      { mode: "business", requirements: [] },
      async (tx) => {
        const rows =
          await tx`select issue from app.status_indexing_issues(${SEARCH_PIPELINE},${at.toISOString()}::timestamptz,
        ${after?.at ?? null}::timestamptz,${after?.id ?? null})`;
        return rows.map((row) => {
          const issue = row.issue as IndexingIssue;
          return { ...issue, title: issue.kind === "record" ? recordDisplayText(issue.title) : issue.title };
        });
      },
    );
  }
}

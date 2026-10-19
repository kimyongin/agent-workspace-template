import {
  type IndexingIssue,
  indexingIssue,
  type IndexingIssuesInput,
  type IndexingIssuesPage,
  indexingIssuesPage,
  type StatusData,
  type StatusInput,
  type StatusOverview,
} from "../../contracts/status.ts";
import { entityReferenceId } from "../../contracts/entity-identity.ts";
import { id } from "../../contracts/common.ts";
import type { Actor } from "../shared/actor.ts";
import { decodeCursor, paginate, scopeOf } from "../shared/operations.ts";
import type { Keyset } from "../shared/store.ts";

export interface StatusDeps {
  reader: {
    overview(actor: Actor, timezone: string, at: Date): Promise<StatusData>;
    issues(actor: Actor, at: Date, after?: Keyset): Promise<IndexingIssue[]>;
  };
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

export async function listIndexingIssues(
  d: StatusDeps,
  actor: Actor,
  input: IndexingIssuesInput,
): Promise<IndexingIssuesPage> {
  const scope = await scopeOf(actor, { list: "indexing_issues", workspace_id: actor.workspaceId });
  const after = input.cursor
    ? decodeCursor(
      input.cursor,
      scope,
      (value) => id.safeParse(value).success || entityReferenceId.safeParse(value).success,
    )
    : undefined;
  const rows = (await d.reader.issues(actor, d.clock.now(), after)).map((row) => indexingIssue.parse(row));
  return indexingIssuesPage.parse(await paginate(rows, 5, (row) => row.created_at, scope));
}

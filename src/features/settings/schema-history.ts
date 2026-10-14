import type { EntitySchemaChangeSummary } from "@contracts/entity-schema-change.ts";
import type { EntitySchemaMigration } from "@contracts/entity-schema-migration.ts";
import type { EntitySchemaVersionSummary } from "@contracts/entity-type.ts";

export type SchemaHistoryRow = {
  id: string;
  changeId?: string;
  change?: EntitySchemaChangeSummary;
  jobs: EntitySchemaMigration[];
  version?: EntitySchemaVersionSummary;
  createdAt: string;
};

/** The publication transaction advances source_schema_version by one; timestamps are never a join key. */
export function schemaHistoryRows(
  changes: EntitySchemaChangeSummary[],
  versions: EntitySchemaVersionSummary[],
  jobs: EntitySchemaMigration[],
): SchemaHistoryRow[] {
  const rows = new Map<string, SchemaHistoryRow>();
  for (const change of changes) {
    rows.set(change.id, {
      id: `change-${change.id}`,
      changeId: change.id,
      change,
      jobs: [],
      createdAt: change.created_at,
    });
  }
  for (const job of jobs) {
    const row = rows.get(job.change_id) ?? {
      id: `change-${job.change_id}`,
      changeId: job.change_id,
      jobs: [],
      createdAt: job.created_at,
    };
    row.jobs.push(job);
    rows.set(job.change_id, row);
  }
  const publications = new Map<number, SchemaHistoryRow>();
  for (const row of rows.values()) {
    row.jobs.sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
    const completed = row.jobs.find((job) => job.status === "succeeded" && job.result);
    const version = completed?.result?.schema_version ??
      (row.change?.status === "applied" ? row.change.source_schema_version + 1 : undefined);
    if (version) {
      publications.set(version, row);
      row.version = {
        type_id: row.change?.type_id ?? row.jobs[0].type_id,
        schema_version: version,
        created_at: completed?.result?.committed_at ?? completed?.updated_at ?? row.change!.updated_at,
      };
      row.createdAt = row.version.created_at;
    }
  }
  for (const version of versions) {
    const published = publications.get(version.schema_version);
    if (published) {
      published.version = version;
      published.createdAt = version.created_at;
    } else {
      rows.set(`version-${version.schema_version}`, {
        id: `version-${version.schema_version}`,
        jobs: [],
        version,
        createdAt: version.created_at,
      });
    }
  }
  return [...rows.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
}

import type postgres from "postgres";
export type EntityResetManifest = {
  run_id: string;
  source_revision: string;
  project_id: string;
  environment: { host: string; port: number; database: string };
  legacy_rows?: Array<{ table: string; key: Record<string, string | number> }>;
  scopes: Array<{ workspace_id: string; actor_id: string; entity_ids: string[] }>;
};
export type EntityResetReport = {
  mode?: "plan" | "applied" | "already-clean";
  run_id: string;
  source_revision: string;
  target_digest: string;
  digest: string;
  preservation_digest: string;
  store_digest: string;
  blockers: Array<{ reason: string; id?: string; workspace_id?: string; request_key?: string; table?: string; count?: number }>;
  counts: Record<string, number>;
  legacy_preconditions: Record<string, number>;
  residual_rows?: number;
};
export const entityResetTables: readonly string[];
export function validateEntityResetManifest(manifest: EntityResetManifest): EntityResetManifest;
export function planEntityReset(manifest: EntityResetManifest, inventory: Record<string, unknown[]>): EntityResetReport;
export function runEntityReset(sql: postgres.Sql, manifest: EntityResetManifest, approval?: EntityResetReport): Promise<EntityResetReport>;

import type postgres from "postgres";

export interface WorkspaceCleanupReport {
  workspace_id: string;
  blockers: { reason: string; id?: string }[];
  counts: Record<string, number>;
  effect_ids: string[];
  digest: string;
  mode?: "dry-run" | "applied" | "already-clean";
  residual_rows?: number;
}
export function validateWorkspaceCleanupManifest(manifest: unknown): unknown;
export function planWorkspaceCleanup(manifest: unknown, inventory: Record<string, Record<string, unknown>[]>): WorkspaceCleanupReport;
export function runWorkspaceCleanup(sql: postgres.Sql, manifest: unknown, approvedReport?: WorkspaceCleanupReport): Promise<WorkspaceCleanupReport>;

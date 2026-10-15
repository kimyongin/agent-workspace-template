import { z } from "zod";
import type { EntityType } from "./entity-type.ts";
export const schemaMigrationStart = z.strictObject({
  expected_change_version: z.number().int().positive(),
  expected_schema_version: z.number().int().positive(),
  analysis_id: z.string().uuid(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
});
export const schemaRecoveryCreate = z.strictObject({
  expected_job_version: z.number().int().positive(),
  expected_schema_version: z.number().int().positive(),
});
export const schemaMigrationAction = z.strictObject({ expected_job_version: z.number().int().positive() });
export const schemaMigrationList = z.strictObject({
  type_id: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(100).default(20),
  before: z.string().uuid().optional(),
});
export const schemaMigrationStatuses = [
  "queued",
  "preparing",
  "ready_to_commit",
  "committing",
  "succeeded",
  "failed",
  "cancelled",
] as const;
export type EntitySchemaMigration = {
  id: string;
  type_id: string;
  type: Pick<EntityType, "id" | "label" | "icon_id" | "archived">;
  change_id: string;
  change_version: number;
  analysis_id: string;
  fingerprint: string;
  source_schema_version: number;
  version: number;
  status: typeof schemaMigrationStatuses[number];
  total: number;
  processed: number;
  retryable: boolean;
  failure_reason: string | null;
  result: { schema_version: number; total: number; changed: number; committed_at: string } | null;
  recovery?: {
    status: "available" | "expired" | "unavailable" | "conflict";
    reason: string | null;
    conflicts?: Array<{ path: string; message: string }>;
    current_schema_version: number;
  };
  source_expires_at: string | null;
  created_at: string;
  updated_at: string;
};
export type SchemaMigrationAccepted = {
  job_id: string;
  type_id: string;
  change_id: string;
  analysis_id: string;
  job_version: number;
  status: "queued";
};

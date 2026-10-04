import type { PrincipleResult } from "@contracts/principle.ts";

/** Frozen Template-20-01 result, pending the parent's shared type integration. */
export type WorkspacePrinciple = Pick<PrincipleResult, "id" | "title" | "summary" | "body" | "version" | "created_at" | "updated_at"> & {
  is_current: boolean;
  saved_at: string;
  change_note: string | null;
  origin: "saved" | "legacy";
  legacy_context: object | null;
};

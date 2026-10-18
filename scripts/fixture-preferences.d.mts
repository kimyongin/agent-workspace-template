import type postgres from "postgres";
export function restoreFixturePreferences(sql: postgres.Sql, actorId: string, original: { value: unknown; sqlNull: boolean }, expected: Record<string, unknown>): Promise<void>;

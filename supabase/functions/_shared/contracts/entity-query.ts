/** Conservative encoded URL budget for the browser's entity list transport. */
export const ENTITY_QUERY_URL_MAX_BYTES = 2048;
/** GET URL values become the same strict input used by POST and MCP. */
export function entityHttpQuery(query: Record<string, string>): Record<string, unknown> {
  const input: Record<string, unknown> = { ...query };
  for (const key of ["filters", "sort"]) {
    if (query[key] !== undefined && (key === "filters" || !["title", "updated_at"].includes(query[key]))) {
      try {
        input[key] = JSON.parse(query[key]);
      } catch {
        input[key] = null;
      }
    }
  }
  return input;
}

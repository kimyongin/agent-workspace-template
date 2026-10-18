export type WorkspaceListKind = "tasks" | "records";

/** Interpret legacy activity links explicitly while keeping their real object/form intent. */
export function activityLocation(kind: WorkspaceListKind, source: URLSearchParams, hash: string) {
  const params = new URLSearchParams(source);
  const create = params.get("create");
  const opposite = kind === "tasks" ? "records" : "tasks";
  const target: WorkspaceListKind = create === (opposite === "tasks" ? "task" : "record")
    ? opposite
    : hash.startsWith(`#activity-${opposite}-`) ? opposite : kind;
  let changed = target !== kind;
  if (create === "task" || create === "record") {
    params.set("create", "1");
    changed = true;
  }
  if (target === "records" && params.has("create")) {
    params.delete("create");
    changed = true;
  }
  if (params.has("tasks_pages") || params.has("records_pages")) {
    const pages = params.get(`${target}_pages`);
    if (pages) params.set("pages", pages);
    params.delete("tasks_pages");
    params.delete("records_pages");
    changed = true;
  }
  const unsupported = target === "tasks" ? ["record_kind", "from", "to"] : ["kind", "status"];
  for (const key of [...unsupported, "collapsed"]) {
    if (params.has(key)) {
      params.delete(key);
      changed = true;
    }
  }
  if (changed) params.set("legacy_activity", "1");
  return { route: `/${target}`, params, hash };
}

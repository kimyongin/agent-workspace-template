import type { EntityType } from "@contracts/entity-type.ts";
export type NavigationRef = { kind: "builtin"; id: "entities" | "tasks" | "records" | "principles" } | {
  kind: "type";
  id: string;
};
export type NavigationEntry = {
  ref: NavigationRef;
  key: string;
  to: string;
  label: string;
  icon: string;
  archived?: boolean;
};
const builtins = {
  entities: { label: "전체 자료", icon: "box" },
  tasks: { label: "할 일", icon: "tool" },
  records: { label: "기록", icon: "book" },
  principles: { label: "원칙", icon: "star" },
};
export function defaultNavigationRefs(types: EntityType[]): NavigationRef[] {
  const active = types.filter((type) => !type.archived).sort((a, b) =>
    a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)
  );
  return [
    ...(active.length
      ? active.slice(0, 2).map((type) => ({ kind: "type" as const, id: type.id }))
      : [{ kind: "builtin" as const, id: "entities" as const }]),
    { kind: "builtin", id: "tasks" },
    { kind: "builtin", id: "records" },
    ...(active.length < 2 ? [{ kind: "builtin" as const, id: "principles" as const }] : []),
  ];
}
/** Resolve names and icons from owner data; refs never contain domain metadata. */
export function resolveNavigationRefs(refs: NavigationRef[], types: EntityType[]): NavigationEntry[] {
  const seen = new Set<string>();
  return refs.flatMap<NavigationEntry>((ref) => {
    const key = `${ref.kind}:${ref.id}`;
    if (seen.has(key)) return [];
    seen.add(key);
    if (ref.kind === "builtin") {
      return Object.hasOwn(builtins, ref.id) ? [{ ref, key, to: `/${ref.id}`, ...builtins[ref.id] }] : [];
    }
    const type = types.find((type) => type.id === ref.id);
    return type
      ? [{
        ref,
        key,
        to: `/entities?entity_type_id=${encodeURIComponent(type.id)}`,
        label: type.label,
        icon: type.icon_id,
        archived: type.archived,
      }]
      : [];
  });
}
export function entityTypeLocation(search: string): string | null {
  const params = new URLSearchParams(search), list = params.get("list");
  if (list?.startsWith("/entities?") && !list.includes("\\")) {
    return new URLSearchParams(list.split("?")[1]).get("entity_type_id");
  }
  return params.get("entity_type_id");
}
export function typeListSearch(params: URLSearchParams, typeId: string): URLSearchParams {
  const next = new URLSearchParams();
  for (const key of ["keyword", "tag_id", "view", "filters"]) {
    const value = params.get(key);
    if (value) next.set(key, value);
  }
  if (typeId) next.set("entity_type_id", typeId);
  return next;
}
export function navigationEntryCurrent(entry: NavigationEntry, section: string | null, typeId: string | null) {
  return entry.ref.kind === "type"
    ? section === "entities" && typeId === entry.ref.id
    : section === entry.ref.id && (entry.ref.id !== "entities" || !typeId);
}
/** Temporary overflow changes visible shortcuts, never the saved priority array. */
export function navigationCapacity(width: number, fontSize: number, sidebar: boolean): number {
  if (sidebar) return 4;
  const minimum = Math.max(44, fontSize * 3);
  return Math.max(0, Math.min(4, Math.floor((width - minimum - 16) / (minimum + 4))));
}

/** Keep the selected plan/history while opening another target in the same workspace. */
export function materialSettingsPath(typeId: string, search: string, values: Record<string, string | null> = {}) {
  const params = new URLSearchParams(search);
  for (const [name, value] of Object.entries(values)) {
    if (value === null) params.delete(name);
    else params.set(name, value);
  }
  return `/settings/entity-types/${typeId}${params.size ? `?${params}` : ""}`;
}

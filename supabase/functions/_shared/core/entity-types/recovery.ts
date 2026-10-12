/** Server-owned historical keys preserve missing values; current-only fields remain untouched. */
export function recoverEntityProperties(
  keys: string[],
  original: Record<string, unknown>,
  current: Record<string, unknown>,
) {
  const after = { ...current };
  for (const key of keys) {
    delete after[key];
    if (Object.hasOwn(original, key)) after[key] = original[key];
  }
  return after;
}

/** A viewer's edit mode returns to the same viewer after save or close. */
export function editFromView(params: URLSearchParams): string {
  const next = new URLSearchParams(params);
  next.set("edit", "1");
  next.set("edit_from", "view");
  return `?${next}`;
}

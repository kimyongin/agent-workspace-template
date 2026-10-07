/** A viewer's edit mode returns to the same viewer after save or cancellation. */
export function editFromView(params: URLSearchParams): string {
  const next = new URLSearchParams(params);
  next.set("edit", "1");
  next.delete("edit_from");
  return `?${next}`;
}

import { resolvedEntityTypeIcon } from "@contracts/entity-type.ts";
export const glyphs = { box: "▣", leaf: "♧", package: "◇", book: "▤", tool: "⚒", star: "☆" };
export function EntityTypeIcon({ id }: { id: string }) {
  return <span aria-hidden="true">{glyphs[resolvedEntityTypeIcon(id)]}</span>;
}

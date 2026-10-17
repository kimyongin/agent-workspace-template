import { BoxIcon, LeafIcon, PackageIcon, BookOpenIcon, WrenchIcon, StarIcon } from "lucide-react";
import { resolvedEntityTypeIcon } from "@contracts/entity-type.ts";
const icons = { box: BoxIcon, leaf: LeafIcon, package: PackageIcon, book: BookOpenIcon, tool: WrenchIcon, star: StarIcon };
/** Stored icon identifiers retain their meaning while Lucide owns their visual form. */
export function EntityTypeIcon({ id }: { id: string }) {
  const icon = resolvedEntityTypeIcon(id), Icon = icons[icon];
  return <Icon data-icon={icon} width="1em" height="1em" className="shrink-0" aria-hidden="true" focusable="false" />;
}

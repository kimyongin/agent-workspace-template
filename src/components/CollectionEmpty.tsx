import type { ReactNode } from "react";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "./ui/empty.tsx";

/** Confirmed empty data; actions stay with the existing collection tools. */
export function CollectionEmpty({ title, description, className }: {
  title: string;
  description?: ReactNode;
  className?: string;
}) {
  return (
    <Empty variant="placeholder" className={className}>
      <EmptyHeader>
        <EmptyTitle>{title}</EmptyTitle>
        {description && <EmptyDescription>{description}</EmptyDescription>}
      </EmptyHeader>
    </Empty>
  );
}

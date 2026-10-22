import type { ComponentProps, ReactNode } from "react";
import { cn } from "../lib/utils.ts";

/** A page owns the spacing between its regions, independently of its route or detail shell. */
export function PageStack({ className, ...props }: ComponentProps<"div">) {
  return <div {...props} className={cn("flex min-w-0 flex-col gap-5", className)} />;
}

export function PageHeading({ title, description, id, tabIndex, children }: {
  title: string; description: string; id?: string; tabIndex?: number; children?: ReactNode;
}) {
  return <header className="flex min-w-0 flex-col gap-2">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-2xl font-semibold tracking-tight wrap-anywhere" id={id} tabIndex={tabIndex}>{title}</h1>
      {children}
    </div>
    <p className="text-sm text-muted-foreground">{description}</p>
  </header>;
}

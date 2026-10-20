import type { ComponentProps, ReactNode } from "react";
import { FieldGroup } from "./ui/field.tsx";
import { cn } from "../lib/utils.ts";

/** A single reading axis that responds to its content area, including narrow nested panels. */
export function DataFields({ className, ...props }: ComponentProps<"dl">) {
  return <dl {...props} className={cn(
    "@container/data-fields flex min-w-0 flex-col gap-3 [&>div]:grid [&>div]:min-w-0 [&>div]:grid-cols-1 [&>div]:gap-x-4 [&>div]:gap-y-1 [&>div>dt]:min-w-0 [&>div>dt]:text-xs @min-[16rem]/data-fields:[&>div>dt]:text-sm [&>div>dt]:text-muted-foreground [&>div>dt]:wrap-anywhere [&>div>dd]:min-w-0 [&>div>dd]:wrap-anywhere @min-[16rem]/data-fields:[&>div]:grid-cols-[minmax(5rem,28%)_minmax(0,1fr)]",
    className,
  )} />;
}

export function DataField({ label, children, className, ...props }: Omit<ComponentProps<"div">, "children"> & {
  label: ReactNode;
  children: ReactNode;
}) {
  return <div {...props} className={cn("min-w-0", className)}><dt>{label}</dt><dd>{children}</dd></div>;
}

/** Editing keeps the reading axis while controls retain their own labels and errors. */
export function DataFieldGroup({ className, ...props }: ComponentProps<typeof FieldGroup>) {
  return <FieldGroup {...props} className={cn(
    "@container/data-edit min-w-0 [&>[data-slot=field]>[data-slot=field-label]]:min-w-0 [&>[data-slot=field]>[data-slot=field-label]]:max-w-full [&>[data-slot=field]>[data-slot=field-label]]:wrap-anywhere [&>[data-slot=field]>[data-slot=field-label]]:text-xs @min-[16rem]/data-edit:[&>[data-slot=field]>[data-slot=field-label]]:text-sm [&>[data-slot=field]:has(>.sr-only)>[data-slot=field-content]]:col-span-full [&>[data-slot=field]]:grid [&>[data-slot=field]]:grid-cols-1 [&>[data-slot=field]]:items-start [&>[data-slot=field]]:gap-x-4 [&>[data-slot=field]]:gap-y-1 @min-[16rem]/data-edit:[&>[data-slot=field]]:grid-cols-[minmax(5rem,28%)_minmax(0,1fr)] @min-[16rem]/data-edit:[&>[data-slot=field]>[data-slot=field-label]]:pt-3",
    className,
  )} />;
}

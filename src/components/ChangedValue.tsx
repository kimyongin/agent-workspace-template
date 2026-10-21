import type { ReactNode } from "react";

/** Read-only values in an existing mutation confirmation; empty values remain explicit. */
export function ChangedValue({ before, after }: { before: ReactNode; after: ReactNode }) {
  return <div className="flex min-w-0 flex-col gap-1">
    <p className="whitespace-pre-wrap"><span className="text-muted-foreground">변경 전: </span>{before === "" || before == null ? "미입력" : before}</p>
    <p className="whitespace-pre-wrap"><span className="text-muted-foreground">변경 후: </span>{after === "" || after == null ? "미입력" : after}</p>
  </div>;
}

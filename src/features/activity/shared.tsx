import { Badge } from "@/components/ui/badge";
// 할 일·기록 화면이 함께 쓰는 작은 표현.
import { taskLabels } from "@contracts/task.ts";

/** 상태는 색과 함께 글자로 표시한다. */
export function StatusBadge({ status }: { status: string }) {
  const label = (taskLabels as Record<string, unknown>)[status] as string | undefined;
  return (
    <Badge variant={status === "missed" ? "destructive" : status === "done" ? "default" : "secondary"}>
      {label ?? status}
    </Badge>
  );
}

export function OccurrenceBadge({ status }: { status: keyof typeof taskLabels.occurrence }) {
  return (
    <Badge variant={status === "missed" ? "destructive" : status === "done" ? "default" : "secondary"}>
      {taskLabels.occurrence[status]}
    </Badge>
  );
}

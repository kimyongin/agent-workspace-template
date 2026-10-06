// 할 일·기록 화면이 함께 쓰는 작은 표현.
import { taskLabels } from "@contracts/task.ts";

const STATUS_CLASS: Record<string, string> = {
  done: "badge badge-done",
  open: "badge badge-due",
  active: "badge badge-due",
  stopped: "badge",
  due: "badge badge-due",
  missed: "badge badge-missed",
  upcoming: "badge",
};

/** 상태는 색과 함께 글자로 표시한다. */
export function StatusBadge({ status }: { status: string }) {
  const label = (taskLabels as Record<string, unknown>)[status] as string | undefined;
  return <span className={STATUS_CLASS[status] ?? "badge"}>{label ?? status}</span>;
}

export function OccurrenceBadge({ status }: { status: keyof typeof taskLabels.occurrence }) {
  return <span className={STATUS_CLASS[status] ?? "badge"}>{taskLabels.occurrence[status]}</span>;
}

// 할 일·기록 화면이 함께 쓰는 작은 표현과 요청 키.
import { taskLabels } from "@contracts/task.ts";
import { useRef } from "react";

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

/**
 * 폼 하나의 요청 키. 저장 응답을 받기 전까지 같은 키를 유지해 재시도가 중복 저장되지 않게 하고,
 * 성공하면 새 키로 바꾼다.
 */
export function useRequestId() {
  const ref = useRef<string>(crypto.randomUUID());
  return {
    get current() {
      return ref.current;
    },
    renew() {
      ref.current = crypto.randomUUID();
    },
  };
}

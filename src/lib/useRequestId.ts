import { useRef } from "react";

/** 폼의 재시도 키. 성공 응답 전까지 유지하고 성공하면 갱신한다. */
export function useRequestId() {
  const ref = useRef<string>(crypto.randomUUID());
  return {
    get current() { return ref.current; },
    renew() { ref.current = crypto.randomUUID(); },
  };
}

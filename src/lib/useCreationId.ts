import { useRef } from "react";

/** 새 데이터의 UUID. 생성 재시도에는 같은 id를 사용하고 다음 생성에는 새 id를 쓴다. */
export function useCreationId() {
  const ref = useRef<string>(crypto.randomUUID());
  return {
    get current() { return ref.current; },
    renew() { ref.current = crypto.randomUUID(); },
  };
}

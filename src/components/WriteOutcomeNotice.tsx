import { useRequestScope, sameRequestScope } from "../lib/api-context.tsx";
import { Alert, AlertDescription } from "./ui/alert.tsx";
import { useEffect, useState } from "react";
import { hasUnresolvedWrites } from "../lib/write-attempt.ts";

/** Lost closures require current-state confirmation; replay results describe the original success. */
export function WriteOutcomeNotice() {
  const scope = useRequestScope();
  const [unresolved]=useState(() => hasUnresolvedWrites(scope));
  const [replayed,setReplayed]=useState(false);
  useEffect(()=>{
    const show=(event: Event)=>{ if (sameRequestScope(event, scope)) setReplayed(true); };
    window.addEventListener("workspace:write-replayed",show);
    return()=>window.removeEventListener("workspace:write-replayed",show);
  },[scope]);
  return <>
    {replayed && <Alert role="status"><AlertDescription>이전 요청의 성공 결과를 확인했습니다. 당시 결과와 버전이므로 현재 상태는 자료를 다시 조회해 확인하세요.</AlertDescription></Alert>}
    {unresolved && <Alert variant="destructive"><AlertDescription>이전 저장 결과를 확인하지 못했습니다. 현재 자료를 조회해 반영 여부를 확인하세요. 입력을 복원해 자동 재전송하지 않습니다. 확인 후 새 작업을 시작하세요.</AlertDescription></Alert>}
  </>;
}

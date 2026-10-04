import { useState } from "react";
import { useLocation, useSearchParams } from "react-router";
import { useDeferredNavigation } from "../lib/useDeferredNavigation.ts";

/** Commit form removal before changing URL, preserving one dirty route guard. */
export function useCreateMode() {
  const location=useLocation(),[params,setParams]=useSearchParams(),afterClose=useDeferredNavigation();
  const [dismissed,setDismissed]=useState<string|null>(null);
  const discard=()=>setDismissed(location.key);
  const finish=(destination:string)=>{discard();afterClose(destination,true);};
  return {open:params.get("create")==="1"&&dismissed!==location.key,key:location.key,discard,finish,
    begin:()=>{const p=new URLSearchParams(params);p.set("create","1");setParams(p);},
    close:()=>{const p=new URLSearchParams(params);p.delete("create");finish(`${location.pathname}?${p}${location.hash}`);}};
}

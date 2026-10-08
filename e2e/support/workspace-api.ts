import type { Page } from "@playwright/test";
import { recordDisplayText } from "../../supabase/functions/_shared/contracts/record-display.ts";
import {base,entity,task,record,principle,stamp,type WorkspaceRows} from "./workspace-data.ts";
type FakeRow={id:string;version:number;body?:string;[key:string]:unknown};
export type FakeOptions={failWrite?:"unknown"|"conflict";hold?:boolean;pageSize?:number};
/** Shared browser adapter only: real consistency, authorization and workflow rules are integration-tested. */
export async function installWorkspaceApi(page:Page,apiOrigin:string,rows:WorkspaceRows,options:FakeOptions={}) {
  const storage=rows as unknown as Record<string,FakeRow[]>;
  const writes:{method:string;path:string;body:Record<string,unknown>;params:URLSearchParams}[]=[],searches:Record<string,unknown>[]=[],reads:string[]=[],errors:string[]=[];
  let sequence=20,failed=false,release=()=>{},started=()=>{};
  const pending=new Promise<void>(r=>{started=r;});
  page.on("pageerror",error=>errors.push(error.message));
  page.on("console",e=>{if(/one blocker|Maximum update depth/.test(e.text()))errors.push(e.text());});
  page.on("request",request=>{if(request.url().startsWith(apiOrigin+"/api/"))reads.push(request.url());});
  await page.route(apiOrigin+"/api/**",async route=>{
    const req=route.request(),url=new URL(req.url()),parts=url.pathname.replace("/api/","").split("/"),[kind,key,action]=parts,method=req.method();
    const body=(req.postDataJSON()??{}) as Record<string,unknown>;
    const reply=(data:unknown,status=200)=>route.fulfill({status,json:data});
    if(kind==="search"){searches.push(body);const selected=String((body.kinds as string[])[0])+"s";return reply({items:(storage[selected]??[]).filter(r=>selected!=="principles"||r.is_current).map(r=>({id:r.id,kind:selected.slice(0,-1),title:selected==="records"?recordDisplayText(String(r.body??"")):r.title,snippet:r.body,snippet_start:0,snippet_end:Array.from(String(r.body??"")).length,at:stamp,tag_ids:r.tag_ids??[],path:`/${selected}/${r.id}`,match:"keyword",index_state:"pending"})),next_cursor:null,anchor_page:null,search_state:body.mode==="auto"?"keyword_fallback":"ok",semantic_coverage:{pending:1,excluded:0}});}
    if(!storage[kind])return reply({code:"invalid_input",message:`Unexpected fixture endpoint ${url.pathname}`},400);
    if(method==="GET") {
      if(kind==="principles"&&key==="current")return reply({current:storage.principles.find(r=>r.is_current)??null});
      if(key){const found=storage[kind].find(r=>r.id===key&&(kind!=="principles"||r.is_current));return found?reply(found):reply({code:"not_found",message:"삭제된 자료"},404);}
      let items=storage[kind];if(kind==="tags")items=items.filter(r=>r.scope===(url.searchParams.get("scope")??"record"));
      if(kind==="principles")return reply({code:"not_found",message:"지원하지 않는 원칙 목록"},404);
      if(kind==="records"&&url.searchParams.get("task_id"))items=items.filter(r=>r.task_id===url.searchParams.get("task_id"));
      if(kind==="records"&&url.searchParams.get("record_kind"))items=items.filter(r=>r.record_kind===url.searchParams.get("record_kind"));
      const offset=Number(url.searchParams.get("cursor")??0),size=options.pageSize??Math.max(1,items.length);
      return reply({items:items.slice(offset,offset+size),next_cursor:items.length>offset+size?String(offset+size):null});
    }
    writes.push({method,path:url.pathname,body,params:url.searchParams});
    if(options.hold){started();await new Promise<void>(r=>{release=r;});options.hold=false;}
    if(options.failWrite&&!failed){failed=true;return options.failWrite==="unknown"?route.abort("connectionreset"):reply({code:"conflict",message:"다른 곳에서 수정했습니다."},409);}
    if(method==="DELETE"||action==="delete"){storage[kind]=storage[kind].filter(r=>r.id!==key);return route.fulfill({status:204});}
    if(kind==="principles"&&method==="POST"&&!key){
      const current=storage.principles.find(r=>r.is_current);if(current)return reply({code:"conflict",message:"현재 원칙이 있습니다"},409);const saved={...principle(sequence++),...body};storage.principles.unshift(saved);return reply(saved,201);
    }
    if(method==="POST"&&!key){const saved={...(kind==="entities"?entity(sequence++):kind==="tasks"?task(sequence++):kind==="records"?record(sequence++):base(sequence++,"")),...body};storage[kind].unshift(saved);return reply(saved,201);}
    const found=storage[kind].find(r=>r.id===key);if(!found)return reply({code:"not_found",message:"자료 없음"},404);
    Object.assign(found,body,{version:found.version+1});
    if(kind==="tasks"&&body.entity_ids)found.entity_context=(body.entity_ids as string[]).map(id=>({id,title:storage.entities.find(e=>e.id===id)?.prop1??"엔터티",source:"selection",captured_at:stamp}));
    return reply(found);
  });
  return {rows,writes,searches,reads,errors,pending,release:()=>release()};
}

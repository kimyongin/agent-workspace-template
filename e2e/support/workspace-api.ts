import { generateDataId } from "../../supabase/functions/_shared/contracts/data-id.ts";
import { defaultEntityIdentitySettings, entityId } from "../../supabase/functions/_shared/contracts/entity-identity.ts";
import type { Page } from "@playwright/test";
import { recordDisplayText } from "../../supabase/functions/_shared/contracts/record-display.ts";
import {base,entity,task,record,principle,stamp,type WorkspaceRows} from "./workspace-data.ts";
type FakeRow={id:string;version:number;body?:string;[key:string]:unknown};
type ReadScope = { entityId?: string; taskId?: string };
type ReadTarget = ReadScope & { kind: keyof WorkspaceRows; id?: string; page?: number };
type ReadFailure = { status?: number; message?: string; once?: boolean };
export type FakeOptions={failWrite?:"unknown"|"conflict";hold?:boolean;pageSize?:number};
/** Shared browser adapter only: real consistency, authorization and workflow rules are integration-tested. */
export async function installWorkspaceApi(page:Page,apiOrigin:string,rows:WorkspaceRows,options:FakeOptions={}) {
  const storage=rows as unknown as Record<string,FakeRow[]>;
  const writes:{method:string;path:string;body:Record<string,unknown>;params:URLSearchParams}[]=[],searches:Record<string,unknown>[]=[],reads:string[]=[],errors:string[]=[];
  const plans = new Map<string, unknown[][]>();
  const failures: { target: ReadTarget; options: ReadFailure }[] = [];
  const holds: { target: ReadTarget; start: () => void; wait: Promise<void>; finish: () => void }[] = [];
  const scopeKey = (kind: string, scope: ReadScope) => JSON.stringify([kind, scope.entityId ?? null, scope.taskId ?? null]);
  const matches = (target: ReadTarget, kind: string, key: string | undefined, scope: ReadScope, page: number) =>
    target.kind === kind && (target.id === undefined || target.id === key) &&
    (target.page === undefined || !key && target.page === page) &&
    (target.entityId === undefined || target.entityId === scope.entityId) &&
    (target.taskId === undefined || target.taskId === scope.taskId);
  let sequence=20,failed=false,release=()=>{},started=()=>{};
  const pending=new Promise<void>(r=>{started=r;});
  page.on("pageerror",error=>errors.push(error.message));
  page.on("console",e=>{if(/one blocker|Maximum update depth/.test(e.text()))errors.push(e.text());});
  page.on("request",request=>{if(request.url().startsWith(apiOrigin+"/api/"))reads.push(request.url());});
  await page.route(apiOrigin+"/api/**",async route=>{
    const req=route.request(),url=new URL(req.url()),parts=url.pathname.replace("/api/","").split("/"),[kind,encodedKey,action]=parts, key=encodedKey ? decodeURIComponent(encodedKey) : undefined, method=req.method();
    const body=(req.postDataJSON()??{}) as Record<string,unknown>;
    if(kind==="ids"&&encodedKey==="allocate")return route.fulfill({json:{id:generateDataId()}});
    const scope = { entityId: url.searchParams.get("entity_id") ?? undefined, taskId: url.searchParams.get("task_id") ?? undefined };
    const plan = plans.get(scopeKey(kind, scope)) ?? plans.get(scopeKey(kind, {}));
    const cursor = url.searchParams.get("cursor");
    const pageNumber = plan ? Number(cursor?.replace("page:", "") ?? 1) : Math.floor(Number(cursor ?? 0) / (options.pageSize ?? 20)) + 1;
    const holdIndex = method === "GET" ? holds.findIndex(h => matches(h.target, kind, key, scope, pageNumber)) : -1;
    const held = holdIndex < 0 ? undefined : holds.splice(holdIndex, 1)[0];
    const failure = method === "GET" ? failures.find(f => matches(f.target, kind, key, scope, pageNumber)) : undefined;
    if (failure && failure.options.once !== false) failures.splice(failures.indexOf(failure), 1);
    const reply = async (data: unknown, status = 200) => {
      // Capture at request time so a delayed read cannot silently become a newer response.
      const captured = structuredClone(data);
      try {
        if (held) { held.start(); await held.wait; }
        return await route.fulfill(failure
          ? { status: failure.options.status ?? 503, json: { code: "internal", message: failure.options.message ?? "fixture read failed" } }
          : { status, json: captured });
      } catch (error) {
        if (!req.failure()) throw error;
      } finally { held?.finish(); }
    };
    if(kind==="settings"&&key==="business")return reply({versions:{record_templates:0,entity_identity:0},settings:{entity_identity:defaultEntityIdentitySettings,record_templates:{}}});
    if(kind==="records"&&key==="prepare"){
      const model=String(body.model),target=(storage[model==="entity"?"entities":`${model}s`]??[]).find(row=>row.id===body.target_id);
      const input=body.input as Record<string,unknown>??{}, facts={...target,...input};
      const labels:Record<string,string>={create:"등록",update:"수정",delete:"삭제",restore:"복원",stop:"중단",resume:"재개"};
      return reply({change_note:body.change_note??`${facts.prop1??facts.title??"항목"} ${labels[String(body.action)]}`,change_tag_ids:body.change_tag_ids??[],missing_tag_ids:[],settings_version:0,prepared_input:input});
    }
    if(kind==="entities"&&key==="prepare"){
      const source=String(body.source??"app"),external_id=String(body.external_id??crypto.randomUUID()),id=entityId(source,external_id);
      const existing=storage.entities.find(row=>row.id===id);
      return reply({source,external_id,id,action:existing?existing.deleted_at?"restore":"duplicate":"create",expected_version:existing?.version,existing:existing??null});
    }
    if(kind==="search"){searches.push(body);const selected=String((body.kinds as string[])[0])+"s";return reply({items:(storage[selected]??[]).filter(r=>selected!=="principles"||r.is_current).map(r=>({id:r.id,kind:selected.slice(0,-1),title:selected==="records"?recordDisplayText(String(r.body??"")):r.title,snippet:r.body,snippet_start:0,snippet_end:Array.from(String(r.body??"")).length,at:stamp,tag_ids:r.tag_ids??[],path:`/${selected}/${encodeURIComponent(r.id)}`,match:"keyword",index_state:"pending"})),next_cursor:null,anchor_page:null,search_state:body.mode==="auto"?"keyword_fallback":"ok",semantic_coverage:{pending:1,excluded:0}});}
    if(!storage[kind])return reply({code:"invalid_input",message:`Unexpected fixture endpoint ${url.pathname}`},400);
    if(method==="GET") {
      if(kind==="principles"&&key==="current")return reply({current:storage.principles.find(r=>r.is_current)??null});
      if(key){const found=storage[kind].find(r=>r.id===key&&(kind!=="principles"||r.is_current));return found?reply(found):reply({code:"not_found",message:"삭제된 자료"},404);}
      if (plan) return reply({ items: plan[pageNumber - 1] ?? [], next_cursor: pageNumber < plan.length ? "page:" + (pageNumber + 1) : null });
      let items=storage[kind];if(kind==="entities")items=items.filter(row=>!row.deleted_at);if(kind==="tags")items=items.filter(r=>r.scope===(url.searchParams.get("scope")??"record"));
      if(kind==="principles")return reply({code:"not_found",message:"지원하지 않는 원칙 목록"},404);
      if(kind==="records"&&url.searchParams.get("task_id"))items=items.filter(r=>r.task_id===url.searchParams.get("task_id"));
      if(kind==="records"&&url.searchParams.get("record_kind"))items=items.filter(r=>r.record_kind===url.searchParams.get("record_kind"));
      const offset=Number(url.searchParams.get("cursor")??0),size=options.pageSize??Math.max(1,items.length);
      return reply({items:items.slice(offset,offset+size),next_cursor:items.length>offset+size?String(offset+size):null});
    }
    writes.push({method,path:url.pathname,body,params:url.searchParams});
    if(options.hold){started();await new Promise<void>(r=>{release=r;});options.hold=false;}
    if(options.failWrite&&!failed){failed=true;return options.failWrite==="unknown"?route.abort("connectionreset"):reply({code:"conflict",message:"다른 곳에서 수정했습니다."},409);}
    if(method==="DELETE"||action==="delete"){if(kind==="entities"){const found=storage.entities.find(row=>row.id===key);if(found)Object.assign(found,{deleted_at:stamp,version:found.version+1});}else storage[kind]=storage[kind].filter(r=>r.id!==key);return route.fulfill({status:204});}
    if(kind==="principles"&&method==="POST"&&!key){
      const current=storage.principles.find(r=>r.is_current);if(current)return reply({code:"conflict",message:"현재 원칙이 있습니다"},409);const saved={...principle(sequence++),...body};storage.principles.unshift(saved);return reply(saved,201);
    }
    if(method==="POST"&&!key){const saved={...(kind==="entities"?entity(sequence++):kind==="tasks"?task(sequence++):kind==="records"?record(sequence++):base(sequence++,"")),...body};if(kind==="entities"){const source=String(body.source??"app"),external_id=String(body.external_id??crypto.randomUUID());Object.assign(saved,{source,external_id,id:entityId(source,external_id)});}storage[kind].unshift(saved);return reply(saved,201);}
    const found=storage[kind].find(r=>r.id===key);if(!found)return reply({code:"not_found",message:"자료 없음"},404);
    Object.assign(found,body,{version:found.version+1});
    if(kind==="tasks"&&body.entity_ids)found.entity_context=(body.entity_ids as string[]).map(id=>({id,title:storage.entities.find(e=>e.id===id)?.prop1??"엔터티",source:"selection",captured_at:stamp}));
    return reply(found);
  });
  return {
    rows,writes,searches,reads,errors,pending,release:()=>release(),
    listPages<K extends keyof WorkspaceRows>(kind: K, pages: WorkspaceRows[K][], scope: ReadScope = {}) {
      plans.set(scopeKey(kind, scope), pages);
    },
    failRead(target: ReadTarget, options: ReadFailure = {}) {
      const failure = { target, options }; failures.push(failure);
      return () => { const index = failures.indexOf(failure); if (index >= 0) failures.splice(index, 1); };
    },
    holdRead(target: ReadTarget) {
      let start!: () => void, release!: () => void, finish!: () => void;
      const started = new Promise<void>(resolve => { start = resolve; });
      const wait = new Promise<void>(resolve => { release = resolve; });
      const finished = new Promise<void>(resolve => { finish = resolve; });
      holds.push({ target, start, wait, finish });
      return { started, release, finished };
    },
  };
}

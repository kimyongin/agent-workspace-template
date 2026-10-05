import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router";
import type { SearchItem, SearchResult } from "@contracts/search.ts";
import type { TaskListItem, TaskResult } from "@contracts/task.ts";
import { taskLabels } from "@contracts/task.ts";
import type { RecordResult } from "@contracts/record.ts";
import { TabActions } from "../../components/TabActions.tsx";
import { clearListPosition, TabSearch } from "../../components/TabSearch.tsx";
import { Field, Notice } from "../../components/Field.tsx";
import { useCreateMode } from "../../components/useCreateMode.ts";
import { api, query } from "../../lib/api.ts";
import { browserTimezone } from "../../lib/format.ts";
import { useRequestId } from "../../lib/useRequestId.ts";
import { TagDictionaryStatus, TagNames, TagReadProvider, useTagDictionary } from "../tags/TagPicker.tsx";
import { ChangeContext, recordKindNames } from "./ChangeContext.tsx";
import { emptyRecord, emptyTask, RecordFormModal, TaskFormModal, taskInput } from "./forms.tsx";
import { useActivityList } from "./useActivityList.ts";
import { Timeline } from "./Timeline.tsx";
import { ACTIVITY_TAG_LIMIT, activityTags, periodBounds, removedActivityFilters } from "./activity-filters.ts";
import { anchorId } from "./list-state.ts";
import { EntityScope } from "../entity/EntityScope.tsx";
import "./activity.css";

type ActivityItem = TaskListItem | RecordResult | SearchItem;
function ActivitySection({ kind, tags, bounds, route, dictionary, otherReady, onReady, locationRef }: { kind: "tasks" | "records"; tags: string[]; bounds: NonNullable<ReturnType<typeof periodBounds>>; route: string; dictionary: ReturnType<typeof useTagDictionary>; otherReady: boolean; onReady: (ready:boolean)=>void; locationRef: React.RefObject<ReturnType<typeof useLocation>> }) {
  const [params] = useSearchParams(), {hash}=useLocation(), q = params.get("q") ?? "";
  const entity = params.get("entity_id") || undefined;
  const [metadata, setMetadata] = useState<SearchResult | null>(null);
  const input = { query: q, kinds: [kind === "tasks" ? "task" : "record"], mode: "auto", limit: 20,
    ...(tags.length ? { tag_ids: tags } : {}), ...(entity ? {entity_id:entity} : {}), ...(kind === "records" ? bounds : {}) };
  const path = q ? JSON.stringify(input) : `/${kind}${query({ limit: 20, entity_id: entity, tag_ids: tags.length ? tags.join(",") : undefined,
    ...(kind === "records" ? { occurred_from: bounds.from, occurred_to: bounds.to } : {}) })}`;
  useEffect(() => setMetadata(null), [path]);
  const list = useActivityList<ActivityItem>(kind, path, `${kind}-title`, `${kind === "tasks" ? "할 일" : "기록"}을 불러오지 못했습니다. 다시 시도하세요.`, (!!dictionary.tags || dictionary.failed) && otherReady, true,
    q ? async (cursor, signal) => { const anchor=anchorId(kind,hash);return await api<SearchResult>("POST", "/search", { ...input, ...(cursor ? { cursor } : anchor?{anchor:{kind:kind==="tasks"?"task":"record",id:anchor}}:{}) }, signal); } : undefined,
    { route, keys: ["q", "tag_ids", "tag_id", "entity_id"], pageKey: `${kind}_pages`, locationRef }, q ? page => setMetadata(page as SearchResult) : undefined);
  useEffect(()=>onReady(!list.busy&&(list.items!==null||!!list.error)),[list.busy,list.items,list.error,onReady]);
  const heading = (item: ActivityItem) => <div className="activity-item-heading"><Link className="item-title" {...list.link(item.id)}>{item.title}</Link><span className="activity-item-actions"><Link {...list.link(item.id)} id={undefined} aria-label={`${item.title} 보기`}>보기</Link><span aria-hidden="true">·</span><Link {...list.link(item.id, true)} aria-label={`${item.title} 편집`}>편집</Link></span></div>;
  const summary = (item: ActivityItem) => <><span className="secondary">{item.summary}</span>{"change_note" in item && item.change_note && <p className="notice">편집 메모: {item.change_note}</p>}{"match" in item && <span className="meta">{item.match === "both" ? "키워드·의미" : item.match === "keyword" ? "키워드" : "의미"} · {item.index_state === "pending" ? "색인 대기" : item.index_state === "excluded" ? "색인 제외" : "색인 완료"}</span>}<TagNames ids={item.tag_ids} compact/></>;
  return <section className={`activity-section ${kind}`} aria-labelledby={`${kind}-title`}>
    <h2 className="section-title" id={`${kind}-title`} tabIndex={-1}>{kind === "tasks" ? "할 일" : "기록"}</h2>
    {q && <p className="help">관련도순으로 회수한 검색 결과{kind === "records" ? "를 날짜별로 표시합니다." : "입니다."}</p>}
    {metadata?.search_state === "keyword_fallback" && <Notice>의미 검색을 사용할 수 없어 키워드 검색 결과를 표시합니다.</Notice>}
    {metadata && metadata.semantic_coverage.pending + metadata.semantic_coverage.excluded > 0 && <p className="help">의미 색인 대기 {metadata.semantic_coverage.pending}개 · 제외 {metadata.semantic_coverage.excluded}개</p>}
    {list.busy && !list.items && <p role="status" className="secondary">불러오는 중…</p>}
    {list.items?.length === 0 && <p className="secondary">{q || tags.length || kind === "records" && (bounds.from || bounds.to) ? `조건에 맞는 ${kind === "tasks" ? "할 일" : "기록"}이 없습니다.` : `아직 ${kind === "tasks" ? "할 일" : "기록"}이 없습니다.`}</p>}
    {list.items && <TagReadProvider dictionary={dictionary} enabled={list.items.some(item => item.tag_ids.length > 0)}>
      {kind === "tasks" ? <ul className="list tasks-list panel">{list.items.map(item => <li key={item.id} className="list-item"><div className="list-item-main">{heading(item)}
        <span className="meta">{"status" in item ? taskLabels[item.status as keyof typeof taskLabels] as string : "task_status" in item && item.task_status ? taskLabels[item.task_status] : "할 일"}{"due_on" in item && item.due_on ? ` · 기한 ${item.due_on}` : ""}</span>{summary(item)}</div></li>)}</ul>
        : <Timeline items={list.items} kind="기록" at={item => "occurred_at" in item ? item.occurred_at : (item as SearchItem).at}>{item => <>{heading(item)}{"change" in item ? <ChangeContext record={item as RecordResult} compact/> : "record_kind" in item && item.record_kind && <span className="meta">{recordKindNames[item.record_kind]}</span>}{"change" in item ? <><span className="secondary">{item.summary}</span><TagNames ids={item.tag_ids} compact/></> : summary(item)}</>}</Timeline>}
    </TagReadProvider>}
    {list.error && <Notice kind="error">{list.error}</Notice>}
    {list.showMoreControl && <button id={`activity-${kind}-page-control`} type="button" className="btn" aria-disabled={list.busy || !list.cursor && !list.error} onClick={list.error ? list.retry : list.more}>{list.busy ? "불러오는 중…" : list.error ? "다시 시도" : list.cursor ? `${kind === "tasks" ? "할 일" : "기록"} 더 보기` : "모두 불러왔습니다"}</button>}
  </section>;
}

export function ActivityPage() {
  const [params, setParams] = useSearchParams(), location = useLocation(), { pathname } = location, dictionary = useTagDictionary(true, true);
  const locationRef = useRef(location), locationKey = useRef(location.key);
  if (locationKey.current !== location.key) { locationKey.current = location.key; locationRef.current = location; }
  const allTags = activityTags(params), tags = allTags.slice(0, ACTIVITY_TAG_LIMIT), from = params.get("from") ?? "", to = params.get("to") ?? "";
  const [trimmedTags, setTrimmedTags] = useState(false);
  const [tasksReady,setTasksReady]=useState(false),[recordsReady,setRecordsReady]=useState(false);
  const checked = periodBounds(from, to), prior = useRef<NonNullable<ReturnType<typeof periodBounds>>>({from:undefined,to:undefined});
  if (checked) prior.current = checked;
  const bounds = checked ?? prior.current;
  useEffect(() => { const overLimit = allTags.length > ACTIVITY_TAG_LIMIT;
    if (!overLimit && !removedActivityFilters.some(key => params.has(key))) return;
    const next = new URLSearchParams(params); removedActivityFilters.forEach(key => next.delete(key));
    if (overLimit) { setTrimmedTags(true); next.delete("tag_id"); next.set("tag_ids", tags.join(",")); clearListPosition(next); }
    setParams(next, { replace: true }); }, [params, setParams]);
  const create = useCreateMode(params.get("create") === "1" ? "1" : params.get("create") === "record" ? "record" : "task"), request = useRequestId();
  const createKind = params.get("create") === "record" || params.get("create") === "1" && pathname === "/records" ? "record" : "task";
  useEffect(() => { if (create.open) request.renew(); }, [create.open, create.key]);
  const begin = (kind: string) => { const next = new URLSearchParams(params); next.set("create", kind); setParams(next); };
  const setDate = (name: string, value: string) => { const next = new URLSearchParams(params); value ? next.set(name, value) : next.delete(name); if(periodBounds(next.get("from")??"",next.get("to")??"")){next.delete("records_pages");next.delete("pages");next.delete("scroll");} setParams(next, { replace: true }); };
  const saved = (kind: string, id: string) => { request.renew(); const next = new URLSearchParams(params); next.delete("create"); create.finish(`/${kind}s/${id}?list=${encodeURIComponent(`${pathname}?${next}`)}`); };
  return <>
    <section className="panel" aria-labelledby="activity-title"><div className="panel-head"><h1 id="activity-title" className="page-title">활동</h1><TabActions title="활동" actions={[{ label: "할 일 등록", run: () => begin("task") }, { label: "기록 작성", run: () => begin("record") }, { label: "활동 태그 관리", to: "/tags/activity" }]}/></div>
      {params.get("entity_id")&&<EntityScope key={params.get("entity_id")} id={params.get("entity_id")!} onClear={()=>{const next=clearListPosition(new URLSearchParams(params));next.delete("entity_id");setParams(next,{replace:true});}}/>}
      <div className="panel-body"><TabSearch/><div className="record-period"><span className="label">기록 기간</span><div className="record-period-inputs">{[["from", "기록 시작일", from], ["to", "기록 종료일", to]].map(([name, label, value]) => <Field key={name} label={label}>{props => <input {...props} type="date" className="input" value={value} aria-invalid={!checked || undefined} onChange={event => setDate(name, event.target.value)}/>}</Field>)}</div>
        {!checked && <Notice kind="error">기록 시작일은 종료일보다 늦을 수 없습니다. 이전 유효 기간의 기록을 유지합니다.</Notice>}
        <p className="help">기간은 기록에만 적용됩니다. 날짜와 시각 기준: {browserTimezone()}</p></div>
        <TagDictionaryStatus dictionary={dictionary}/><fieldset className="field tag-filter-chips"><legend className="label">활동 태그</legend><div className="chips">{dictionary.tags?.map(tag => <button type="button" key={tag.id} className="chip" disabled={tags.length >= ACTIVITY_TAG_LIMIT && !tags.includes(tag.id)} aria-pressed={tags.includes(tag.id)} onClick={() => { setTrimmedTags(false); const selected = tags.includes(tag.id) ? tags.filter(id => id !== tag.id) : [...tags, tag.id]; const next = clearListPosition(new URLSearchParams(params)); next.delete("tag_id"); selected.length ? next.set("tag_ids", selected.sort().join(",")) : next.delete("tag_ids"); setParams(next, { replace: true }); }}>{tag.name}</button>)}</div>{(trimmedTags || tags.length === ACTIVITY_TAG_LIMIT) && <p className="help" role="status">{trimmedTags ? "태그는 최대 10개입니다. 기존 조건의 앞 10개만 적용했습니다." : "태그는 최대 10개까지 선택할 수 있습니다. 선택한 태그를 해제하면 바꿀 수 있습니다."}</p>}</fieldset>
      </div>
    </section>
    <ActivitySection kind="tasks" tags={tags} bounds={bounds} route={pathname} dictionary={dictionary} otherReady={recordsReady} onReady={setTasksReady} locationRef={locationRef}/>
    <ActivitySection kind="records" tags={tags} bounds={bounds} route={pathname} dictionary={dictionary} otherReady={tasksReady} onReady={setRecordsReady} locationRef={locationRef}/>
    {create.open && (createKind === "task" ? <TaskFormModal key={create.key} mode="create" open initial={emptyTask()} onClose={create.close} onRouteDiscard={create.discard} onSave={async draft => { const task = await api<TaskResult>("POST", "/tasks", { ...taskInput(draft), request_id: request.current }); saved("task", task.id); }}/>
      : <RecordFormModal key={create.key} title="기록 작성" submitLabel="저장" open initial={emptyRecord()} onClose={create.close} onRouteDiscard={create.discard} onSave={async draft => { const record = await api<RecordResult>("POST", "/records", { ...draft, request_id: request.current }); saved("record", record.id); }}/>) }
  </>;
}

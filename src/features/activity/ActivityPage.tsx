import { recordDisplayText } from "@contracts/record-display.ts";
import { SearchMatch } from "../../components/SearchMatch.tsx";
import { useEffect, useRef, useState } from "react";
import { Navigate, useLocation, useSearchParams } from "react-router";
import type { SearchItem } from "@contracts/search.ts";
import type { TaskResult } from "@contracts/task.ts";
import { taskLabels } from "@contracts/task.ts";
import type { RecordResult } from "@contracts/record.ts";
import { TabCreateButton } from "../../components/TabCreateButton.tsx";
import { clearListPosition, TabSearch, TabFilters } from "../../components/TabSearch.tsx";
import { Field, Notice } from "../../components/Field.tsx";
import { useCreateMode } from "../../components/useCreateMode.ts";
import { api } from "../../lib/api.ts";
import { useDisplayTime } from "../../lib/useDisplayTime.ts";
import { TagDictionaryStatus, TagReadProvider, useTagDictionary } from "../tags/TagPicker.tsx";
import { recordKindNames } from "./ChangeContext.tsx";
import { emptyRecord, emptyTask, RecordFormModal, TaskFormModal, taskInput } from "./forms.tsx";
import { type ActivityItem, useActivityList } from "./useActivityList.ts";
import { Timeline } from "./Timeline.tsx";
import { ACTIVITY_TAG_LIMIT, activityTags, periodBounds } from "./activity-filters.ts";
import { activityLocation, type WorkspaceListKind } from "./activity-location.ts";
import { EntityScope } from "../entity/EntityScope.tsx";
import { ListExpansionProvider, ListPreviewItem } from "../relations/ListPreviewItem.tsx";
import "./activity.css";

function ActivitySection({ kind, tags, bounds, dictionary }: { kind: WorkspaceListKind; tags: string[]; bounds: NonNullable<ReturnType<typeof periodBounds>>; dictionary: ReturnType<typeof useTagDictionary> }) {
  const list = useActivityList(kind, { tags, bounds, layoutReady: !!dictionary.tags || dictionary.failed });
  const { metadata, searching: q, filtered } = list;
  const displayText = (item: ActivityItem) => kind === "records" && "body" in item ? recordDisplayText(item.body) : "title" in item ? item.title : "기록";
  const preview = (item: ActivityItem) => <ListPreviewItem kind={kind} id={item.id} title={displayText(item)} metadata={"match" in item?<SearchMatch item={item}/>:undefined}/>;
  return <section className={`activity-section ${kind}`} aria-label={`${kind === "tasks" ? "할 일" : "기록"} 목록`}>
    {q && <p className="help">관련도순으로 회수한 검색 결과{kind === "records" ? "를 날짜별로 표시합니다." : "입니다."}</p>}
    {metadata?.search_state === "keyword_fallback" && <Notice>의미 검색을 사용할 수 없어 키워드 검색 결과를 표시합니다.</Notice>}
    {metadata && metadata.semantic_coverage.pending + metadata.semantic_coverage.excluded > 0 && <p className="help">의미 색인 대기 {metadata.semantic_coverage.pending}개 · 제외 {metadata.semantic_coverage.excluded}개</p>}
    {list.busy && !list.items && <p role="status" className="secondary">불러오는 중…</p>}
    {list.items?.length === 0 && <p className="secondary">{filtered ? `조건에 맞는 ${kind === "tasks" ? "할 일" : "기록"}이 없습니다.` : `아직 ${kind === "tasks" ? "할 일" : "기록"}이 없습니다.`}</p>}
    {list.items && <ListExpansionProvider><TagReadProvider dictionary={dictionary} enabled={list.items.some(item => item.tag_ids.length > 0)}>
      {kind === "tasks" ? <ul className="list disclosure-list panel">{list.items.map(item => <li key={item.id} className="list-item"><div className="list-item-main">{preview(item)}</div></li>)}</ul>
        : <Timeline items={list.items} kind="기록" at={item => "occurred_at" in item ? item.occurred_at : (item as SearchItem).at}>{item => preview(item)}</Timeline>}
    </TagReadProvider></ListExpansionProvider>}
    {list.error && <Notice kind="error">{list.error}</Notice>}
    {list.showMoreControl && <button id={`activity-${kind}-page-control`} type="button" className="btn" aria-disabled={list.busy || !list.cursor && !list.error} onClick={list.error ? list.retry : list.more}>{list.busy ? "불러오는 중…" : list.error ? "다시 시도" : list.cursor ? `${kind === "tasks" ? "할 일" : "기록"} 더 보기` : "모두 불러왔습니다"}</button>}
  </section>;
}

export function ActivityPage({ kind }: { kind: WorkspaceListKind }) {
  const { timezone } = useDisplayTime();
  const [params, setParams] = useSearchParams(), location = useLocation(), { pathname } = location, dictionary = useTagDictionary(true, true, kind === "tasks" ? "task" : "record");
  const label = kind === "tasks" ? "할 일" : "기록";
  const legacy = activityLocation(kind, params, location.hash);
  const allTags = activityTags(params), tags = allTags.slice(0, ACTIVITY_TAG_LIMIT), from = params.get("from") ?? "", to = params.get("to") ?? "";
  const [trimmedTags, setTrimmedTags] = useState(false);
  const checked = periodBounds(from, to, timezone), prior = useRef({from:"",to:""});
  if (checked) prior.current = {from, to};
  const bounds = checked ?? periodBounds(prior.current.from, prior.current.to, timezone)!;
  useEffect(() => { const overLimit = allTags.length > ACTIVITY_TAG_LIMIT;
    if (!allTags.length) setTrimmedTags(false);
    if (!overLimit) return;
    const next = new URLSearchParams(params);
    if (overLimit) { setTrimmedTags(true); next.delete("tag_id"); next.set("tag_ids", tags.join(",")); clearListPosition(next); }
    setParams(next, { replace: true }); }, [params, setParams]);
  const create = useCreateMode("1");
  const begin = () => { const next = new URLSearchParams(params); next.set("create", "1"); setParams(next); };
  const filter = (name: string, value: string) => { const next = clearListPosition(new URLSearchParams(params)); value ? next.set(name, value) : next.delete(name); setParams(next, { replace: true }); };
  const setDate = (name: string, value: string) => { const next = new URLSearchParams(params); value ? next.set(name, value) : next.delete(name); if(periodBounds(next.get("from")??"",next.get("to")??"", timezone))clearListPosition(next); setParams(next, { replace: true }); };
  const saved = (kind: string, id: string) => { const next = new URLSearchParams(params); next.delete("create"); create.finish(`/${kind}s/${id}?list=${encodeURIComponent(`${pathname}?${next}`)}`); };
  if (legacy.route !== pathname || legacy.params.toString() !== params.toString()) return <Navigate replace to={`${legacy.route}?${legacy.params}${legacy.hash}`} />;
  return <>
    <section className="panel main-tab-header" aria-labelledby={`${kind}-title`}><div className="panel-head"><h1 id={`${kind}-title`} className="page-title" tabIndex={-1}>{label}</h1><TabCreateButton label={kind === "tasks" ? "할 일 등록" : "기록 작성"} onClick={begin}/></div>
      <div className="panel-body">
        {params.has("legacy_activity") && <Notice>목록을 나누어 {label} 탭으로 이동했습니다. {kind === "tasks" ? "기록과 기록 기간은 기록 탭에서 확인하세요." : "할 일과 진행 상태는 할 일 탭에서 확인하세요."}</Notice>}
        <TabSearch/>
        <TabFilters active={!!(tags.length||params.get("entity_id")||params.get("kind")||params.get("status")||params.get("record_kind")||from||to)} attention={!checked||dictionary.failed||trimmedTags}>
      {params.get("entity_id")&&<EntityScope key={params.get("entity_id")} id={params.get("entity_id")!} onClear={()=>{const next=clearListPosition(new URLSearchParams(params));next.delete("entity_id");setParams(next,{replace:true});}}/>}
        <div className="filter-grid">
          {kind === "tasks" ? <>
            <Field label="할 일 종류">{props => <select {...props} className="input" value={params.get("kind") ?? ""} onChange={event => filter("kind", event.target.value)}><option value="">전체</option><option value="once">한 번</option><option value="recurring">반복</option></select>}</Field>
            <Field label="할 일 상태">{props => <select {...props} className="input" value={params.get("status") ?? ""} onChange={event => filter("status", event.target.value)}><option value="">전체</option>{["open", "done", "active", "stopped"].map(status => <option key={status} value={status}>{taskLabels[status as keyof typeof taskLabels] as string}</option>)}</select>}</Field>
          </> : <Field label="기록 종류">{props => <select {...props} className="input" value={params.get("record_kind") ?? ""} onChange={event => filter("record_kind", event.target.value)}><option value="">전체</option>{Object.entries(recordKindNames).map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select>}</Field>}
        {kind === "records" && <>{[["from", "기록 시작일", from], ["to", "기록 종료일", to]].map(([name, label, value]) => <Field key={name} label={label}>{props => <input {...props} type="date" className="input" value={value} aria-invalid={!checked || undefined} onChange={event => setDate(name, event.target.value)}/>}</Field>)} </>}
        </div>
        {kind === "records" && !checked && <Notice kind="error">기록 시작일은 종료일보다 늦을 수 없습니다. 이전 유효 기간의 기록을 유지합니다.</Notice>}
        <TagDictionaryStatus dictionary={dictionary}/><fieldset className="field tag-filter-chips"><legend className="label">{label} 태그</legend><div className="chips">{dictionary.tags?.map(tag => <button type="button" key={tag.id} className="chip" disabled={tags.length >= ACTIVITY_TAG_LIMIT && !tags.includes(tag.id)} aria-pressed={tags.includes(tag.id)} onClick={() => { setTrimmedTags(false); const selected = tags.includes(tag.id) ? tags.filter(id => id !== tag.id) : [...tags, tag.id]; const next = clearListPosition(new URLSearchParams(params)); next.delete("tag_id"); selected.length ? next.set("tag_ids", selected.sort().join(",")) : next.delete("tag_ids"); setParams(next, { replace: true }); }}>{tag.name}</button>)}</div>{(trimmedTags || tags.length === ACTIVITY_TAG_LIMIT) && <p className="help" role="status">{trimmedTags ? "태그는 최대 10개입니다. 기존 조건의 앞 10개만 적용했습니다." : "태그는 최대 10개까지 선택할 수 있습니다. 선택한 태그를 해제하면 바꿀 수 있습니다."}</p>}</fieldset>
        </TabFilters>
      </div>
    </section>
    <ActivitySection kind={kind} tags={tags} bounds={bounds} dictionary={dictionary}/>
    {create.open && (kind === "tasks" ? <TaskFormModal key={create.key} mode="create" open initial={emptyTask(timezone)} onClose={create.close} onRouteDiscard={create.discard} onSave={async (draft, creationId) => { const task = await api<TaskResult>("POST", "/tasks", { ...taskInput(draft), id: creationId() }); saved("task", task.id); }}/>
      : <RecordFormModal key={create.key} title="기록 작성" submitLabel="저장" open initial={emptyRecord()} onClose={create.close} onRouteDiscard={create.discard} onSave={async (draft, creationId) => { const record = await api<RecordResult>("POST", "/records", { ...draft, id: creationId() }); saved("record", record.id); }}/>) }
  </>;
}

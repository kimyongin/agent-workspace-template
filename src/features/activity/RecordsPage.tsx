// 기록 목록(수행 시각 내림차순)과 직접 작성.
import type { RecordResult } from "@contracts/record.ts";
import { useState } from "react";
import { Link, useNavigate,useSearchParams } from "react-router";
import {useDeferredNavigation} from "../../lib/useDeferredNavigation.ts";
import { Notice } from "../../components/Field.tsx";
import { api, query } from "../../lib/api.ts";
import { browserTimezone, formatDateTime } from "../../lib/format.ts";
import { emptyRecord, RecordFormModal } from "./forms.tsx";
import { useRequestId } from "./shared.tsx";
import {TagFilter, TagNames, TagReadProvider, useTagDictionary} from "../tags/TagPicker.tsx";
import { useActivityList } from "./useActivityList.ts";
import {EntityPicker} from "../entity/EntityPicker.tsx";
import { ActivityTabs } from "./ActivityTabs.tsx";
import { GuideLink } from "../../components/GuideLink.tsx";

import { collapsedDates, groupRecords } from "./timeline.ts";
import "./activity.css";

export function RecordsPage() {
  const tagDictionary = useTagDictionary();
  const [params,setParams]=useSearchParams();const tag_id=params.get("tag_id")??"";
  const entity_id=params.get("entity_id")??"";
  const list = useActivityList<RecordResult>("records", `/records${query({ limit: 20, tag_id, entity_id })}`,
    "records-title", "기록을 불러오지 못했습니다. 다시 시도하세요.", tagDictionary.tags !== null || tagDictionary.failed);
  const { items, cursor, error, busy: loadingMore, more } = list;
  const [creating, setCreating] = useState(false);
  const requestId = useRequestId();
  const navigate = useNavigate();
  const navigateAfterClose = useDeferredNavigation();
  const timezone = browserTimezone();
  const collapsed = collapsedDates(params);
  const toggleDate = (date: string) => {
    const next = new URLSearchParams(params);
    collapsed.has(date) ? collapsed.delete(date) : collapsed.add(date);
    collapsed.size ? next.set("collapsed", [...collapsed].join(",")) : next.delete("collapsed");
    setParams(next, { replace: true });
  };

  return (
    <section className="panel" aria-labelledby="records-title">
      <ActivityTabs />
      <div className="panel-head">
        <h1 id="records-title" className="page-title" tabIndex={-1}>기록</h1>
        <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>기록 작성</button>
      </div>
      <div className="activity-filters" role="group" aria-label="기록 필터">
      <TagFilter dictionary={tagDictionary} value={tag_id} onChange={id=>{const next=new URLSearchParams(params);next.delete("pages");next.delete("scroll");next.delete("collapsed");id?next.set("tag_id",id):next.delete("tag_id");setParams(next);}}/>
      <EntityPicker label="엔터티 필터" value={entity_id} onChange={id=>{const next=new URLSearchParams(params);next.delete("pages");next.delete("scroll");next.delete("collapsed");id?next.set("entity_id",id):next.delete("entity_id");setParams(next);}}/>
      {(tag_id || entity_id) && <button className="btn filter-reset" onClick={() => setParams({}, {replace:true})}>필터 해제</button>}
      </div>
      <p className="help">날짜와 시각 기준: {timezone}</p>
      {items === null && !error && <p className="secondary" role="status">불러오는 중…</p>}
      {items?.length === 0 && (
        <div className="empty">
          <p className="secondary" style={{ margin: 0 }}>{tag_id || entity_id ? "조건에 맞는 기록이 없습니다. 필터를 변경하거나 해제하세요." : "아직 기록이 없습니다. 수행한 일과 결과를 기록하세요."}</p>
          {!tag_id && !entity_id && <GuideLink />}
        </div>
      )}
      {items && items.length > 0 && (
        <TagReadProvider dictionary={tagDictionary} enabled={items.some(r=>r.tag_ids.length>0)}><div className="record-timeline">{groupRecords(items, timezone).map(({date, records}) => <section key={date} className="record-date-group" aria-label={`${date} 기록`}>
        <h2 className="section-title"><button type="button" className="btn record-date-toggle" aria-label={`${date} 기록`} aria-expanded={!collapsed.has(date)} aria-controls={`records-date-${date}`} onClick={() => toggleDate(date)}>{date}</button></h2>
        <ul className="list" id={`records-date-${date}`} hidden={collapsed.has(date)}>
          {records.map((r) => (
            <li key={r.id} className="list-item">
              <div className="list-item-main">
                <div className="activity-item-heading"><Link className="item-title" {...list.link(r.id)}>{r.title}</Link>
                <span className="activity-item-actions"><Link {...list.link(r.id)} id={undefined} aria-label={`${r.title} 보기`}>보기</Link><Link {...list.link(r.id,true)} aria-label={`${r.title} 편집`}>편집</Link></span></div>
                <span className="secondary">{r.summary}</span>
                <span className="meta">
                  {formatDateTime(r.occurred_at)}
                  {r.occurrence_on ? ` · ${r.occurrence_on} 회차` : r.task_id ? " · 할 일 결과" : ""}
                </span>
                <TagNames ids={r.tag_ids} compact />
              </div>
            </li>
          ))}
        </ul></section>)}</div></TagReadProvider>
      )}
      {error && <Notice kind="error">{error}</Notice>}
      {list.showMoreControl && (
        <button id="activity-records-page-control" type="button" className="btn" onClick={error ? list.retry : more}
          aria-disabled={loadingMore || (!cursor && !error)}>
          {loadingMore ? "불러오는 중…" : error ? "다시 시도" : cursor ? "더 보기" : "모두 불러왔습니다"}
        </button>
      )}
      {creating && (
        <RecordFormModal
          title="기록 작성"
          submitLabel="저장"
          open
          initial={emptyRecord()}
          onClose={() => setCreating(false)}
          onRouteDiscard={() => setCreating(false)}
          onSave={async (value) => {
            const created = await api<RecordResult>("POST", "/records", { ...value, request_id: requestId.current });
            requestId.renew();
            setCreating(false);
            navigateAfterClose(`/records/${created.id}${query({tag_id})}`);
          }}
        />
      )}
    </section>
  );
}

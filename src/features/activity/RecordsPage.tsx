// 기록 목록(수행 시각 내림차순)과 직접 작성.
import type { RecordResult } from "@contracts/record.ts";
import { useState } from "react";
import { Link, useNavigate,useSearchParams } from "react-router";
import { Notice } from "../../components/Field.tsx";
import { api, query } from "../../lib/api.ts";
import { formatDateTime } from "../../lib/format.ts";
import { emptyRecord, RecordFormModal } from "./forms.tsx";
import { useRequestId } from "./shared.tsx";
import {TagFilter} from "../tags/TagPicker.tsx";
import { useActivityList } from "./useActivityList.ts";
import {EntityPicker} from "../entity/EntityPicker.tsx";

export function RecordsPage() {
  const [params,setParams]=useSearchParams();const tag_id=params.get("tag_id")??"";
  const entity_id=params.get("entity_id")??"";
  const list = useActivityList<RecordResult>("records", `/records${query({ limit: 20, tag_id, entity_id })}`,
    "records-title", "기록을 불러오지 못했습니다. 다시 시도하세요.");
  const { items, cursor, error, busy: loadingMore, more } = list;
  const [creating, setCreating] = useState(false);
  const requestId = useRequestId();
  const navigate = useNavigate();

  return (
    <section className="panel" aria-labelledby="records-title">
      <div className="panel-head">
        <h1 id="records-title" className="page-title" tabIndex={-1}>기록</h1>
        <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>기록 작성</button>
      </div>
      {error && <Notice kind="error">{error}</Notice>}
      <TagFilter value={tag_id} onChange={id=>{const next=new URLSearchParams(params);next.delete("pages");next.delete("scroll");id?next.set("tag_id",id):next.delete("tag_id");setParams(next);}}/>
      <EntityPicker label="엔터티 필터" value={entity_id} onChange={id=>{const next=new URLSearchParams(params);next.delete("pages");next.delete("scroll");id?next.set("entity_id",id):next.delete("entity_id");setParams(next);}}/>
      {items === null && !error && <p className="secondary" role="status">불러오는 중…</p>}
      {items?.length === 0 && (
        <p className="secondary" style={{ margin: 0 }}>{tag_id || entity_id ? "조건에 맞는 기록이 없습니다. 필터를 변경하거나 해제하세요." : "아직 기록이 없습니다. 수행한 일과 결과를 기록하세요."}</p>
      )}
      {items && items.length > 0 && (
        <ul className="list">
          {items.map((r) => (
            <li key={r.id} className="list-item">
              <div className="list-item-main">
                <Link className="item-title" {...list.link(r.id)}>{r.title}</Link>
                <span className="secondary">{r.summary}</span>
                <span className="meta">
                  {formatDateTime(r.occurred_at)}
                  {r.occurrence_on ? ` · ${r.occurrence_on} 회차` : r.task_id ? " · 할 일 결과" : ""}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
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
          onSave={async (value) => {
            const created = await api<RecordResult>("POST", "/records", { ...value, request_id: requestId.current });
            requestId.renew();
            setCreating(false);
            navigate(`/records/${created.id}${query({tag_id})}`);
          }}
        />
      )}
    </section>
  );
}

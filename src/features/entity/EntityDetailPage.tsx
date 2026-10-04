import { safeListReturn } from "../activity/list-state.ts";
import { DeleteDialog } from "../../components/DeleteDialog.tsx";
import { useDeferredNavigation } from "../../lib/useDeferredNavigation.ts";
import { TagNames } from "../tags/TagPicker.tsx";
import type { EntityDetail } from "@contracts/entity.ts";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import { Notice } from "../../components/Field.tsx";
import { DetailSurface } from "../../components/Modal.tsx";
import { api, ApiError, query } from "../../lib/api.ts";
import { formatDateTime } from "../../lib/format.ts";
import { EntityForm } from "./forms.tsx";
import { emptyRecord, emptyTask, RecordFormModal, TaskFormModal, taskInput } from "../activity/forms.tsx";
import { useRequestId } from "../../lib/useRequestId.ts";
import "./entity.css";
export function EntityDetailPage() {
  const { id } = useParams(),
    [params] = useSearchParams(),
    navigate = useNavigate();
  const afterClose=useDeferredNavigation();
  const conflicted = useRef(false);
  const request = useRequestId();
  const location=useLocation();
  const [creating, setCreating] = useState<"task" | "record" | null>(null);
  const closeCreate=()=>{setCreating(null);const p=new URLSearchParams(params);p.delete("create");afterClose(`${location.pathname}?${p}`,true);};
  useEffect(()=>{const value=params.get("create");setCreating(value==="task"||value==="record"?value:null);},[params.toString()]);
  const [editReady,setEditReady]=useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [entity, setEntity] = useState<EntityDetail | null>(null),
    [error, setError] = useState<string | null>(null),
    [retry, setRetry] = useState(0),
    [editing, setEditing] = useState(false),
    [deleting, setDeleting] = useState(false),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    api<EntityDetail>("GET", `/entities/${id}`, undefined, controller.signal)
      .then(value => { if (!controller.signal.aborted){setEntity(value);setEditReady(true);} }).catch((e) => {
        if (!controller.signal.aborted) {
          setError(
            e instanceof ApiError ? e.message : "엔터티를 불러오지 못했습니다.",
          );
        }
      });
    return () => controller.abort();
  }, [id, retry]);
  useEffect(() => { setEntity(null); setSaved(null); setEditing(false); setDeleting(false); }, [id]);
  const returnParams=new URLSearchParams(params); ["edit","edit_from","create"].forEach(key=>returnParams.delete(key));
  const back = safeListReturn(params.get("list"),"entities",`/entities?${returnParams}${id ? `#entity-${id}` : ""}`);
  const previousQuery=useRef(params.toString());
  useEffect(()=>{setEditing(params.get("edit")==="1");if(previousQuery.current!==params.toString()&&params.get("edit")==="1"){request.renew();setEditReady(false);setRetry(n=>n+1);}previousQuery.current=params.toString();},[params.toString()]);
  const closeEdit=()=>{setEditing(false);if(params.get("edit_from")==="view"){const p=new URLSearchParams(params);p.delete("edit");p.delete("edit_from");afterClose(`?${p}`,true);}else afterClose(back,true);if(conflicted.current){conflicted.current=false;setRetry(n=>n+1);}};
  return (
    <DetailSurface title={entity?.prop1??"엔터티"} onClose={()=>navigate(back)} busy={busy}><section className="panel">
      <Link className="action-link" to={back}>← 엔터티 목록</Link>
      {saved && <Notice>{saved}</Notice>}
      {error && (
        <>
          <Notice kind="error">{error}</Notice>
          <button className="btn" onClick={() => setRetry((n) => n + 1)}>
            다시 시도
          </button>
        </>
      )}
      {!entity && !error && (
        <p className="secondary" role="status">불러오는 중…</p>
      )}
      {entity && (
        <>
          <div className="panel-head">
            <div className="actions">
              <button className="btn" onClick={() => {const p=new URLSearchParams(params);p.set("edit","1");p.set("edit_from","view");navigate(`?${p}`,{replace:true});}}>
                편집
              </button>
              <button
                className="btn btn-danger"
                onClick={() => {request.renew();setDeleting(true);}}
              >
                삭제
              </button>
            </div>
          </div>
          <dl className="entity-properties">
            <dt className="label">속성 1</dt>
            <dd className="value">{entity.prop1}</dd>
            <dt className="label">속성 2</dt>
            <dd className="value">{entity.prop2 ?? "미지정"}</dd>
            <dt className="label">속성 3</dt>
            <dd className="value">{entity.prop3 ?? "미지정"}</dd>
            <dt className="label">속성 4</dt>
            <dd className="value">{entity.prop4}</dd>
          </dl>
          <TagNames scope="entity" ids={(entity as EntityDetail & {tag_ids?:string[]}).tag_ids??[]}/>
          <p className="meta">
            수정 {formatDateTime(entity.updated_at)}
          </p>
          {([["tasks", "할 일"], ["records", "기록"]] as const).map(([kind, label]) => (
            <section className="entity-related" key={kind}>
              <h2 className="section-title">
                연결된 {label} ({entity[kind].count}개)
              </h2>
              <Link to={`/${kind}${query({ entity_id: id })}`}>
                전체 {label} 보기
              </Link>
              {<button className="btn" onClick={() => {
                request.renew();setCreating(kind==="tasks"?"task":"record");const p=new URLSearchParams(params);p.set("create",kind==="tasks"?"task":"record");navigate(`?${p}`);
              }}>{kind === "tasks" ? "관련 할 일 추가" : "기록 작성"}</button>}
              {entity[kind].count === 0
                ? <p className="secondary">연결된 {label}이 없습니다.</p>
                : (
                  <ul className="list">
                    {entity[kind].items.map((item) => (
                      <li className="list-item" key={item.id}>
                        <Link className="item-title" to={`/${kind}/${item.id}`}>
                          {item.title}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
            </section>
          ))}
          {creating === "task" && <TaskFormModal open mode="create" initial={{ ...emptyTask(), entity_id: entity.id }}
            onClose={closeCreate} onRouteDiscard={()=>setCreating(null)} onSave={async draft => {
              await api("POST", "/tasks", { ...taskInput(draft), request_id: request.current });
              closeCreate(); setSaved("할 일을 추가했습니다."); setRetry(n => n + 1);
            }} />}
          {creating === "record" && <RecordFormModal open title="기록 작성" submitLabel="저장" initial={{ ...emptyRecord(), entity_id: entity.id }}
            onClose={() => setCreating(null)} onSave={async value => {
              await api("POST", "/records", { ...value, request_id: request.current });
              closeCreate(); setSaved("기록을 저장했습니다."); setRetry(n => n + 1);
            }} />}
          {editing && editReady && (
            <EntityForm
              initial={entity}
              onClose={closeEdit}
              onRouteDiscard={()=>setEditing(false)}
              onSave={async (value) => {
                try {
                  const savedEntity=await api<EntityDetail>("PATCH", `/entities/${id}`, {
                    ...value,
                    expected_version: entity.version,
                    request_id:request.current,
                  });
                  setEntity(current=>current?{...current,...savedEntity}:current);
                  setSaved("저장했습니다.");request.renew(); closeEdit();
                  setRetry((n) => n + 1);
                } catch (e) {
                  if (
                    e instanceof ApiError && e.code === "conflict"
                  ) conflicted.current = true;
                  throw e;
                }
              }}
            />
          )}
          {deleting && (
            <DeleteDialog
              title="엔터티를 삭제할까요?"
              message={`${entity.prop1}을 삭제하고 연결을 해제합니다. 할 일·기록 원문은 보존합니다.`}
              busy={busy}
              onCancel={() => setDeleting(false)}
              onConfirm={async (reason) => {
                setBusy(true);
                try {
                  await api(
                    "DELETE",
                    `/entities/${id}${query({expected_version:entity.version,change_note:reason,request_id:request.current})}`,
                  );
                  afterClose(back,true);
                } catch (e) {
                  setError(
                    e instanceof ApiError ? e.message : "삭제하지 못했습니다.",
                  );
                  setDeleting(false);
                } finally {
                  setBusy(false);
                }
              }}
            />
          )}
        </>
      )}
    </section></DetailSurface>
  );
}

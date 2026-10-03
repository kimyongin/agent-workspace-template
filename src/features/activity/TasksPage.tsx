// 할 일 목록: 종류·상태 필터(URL에 보관해 상세 왕복 뒤 유지), 커서 더 보기, 작성 모달.
import type { TaskListItem, TaskResult } from "@contracts/task.ts";
import { taskLabels } from "@contracts/task.ts";
import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { Notice } from "../../components/Field.tsx";
import { api, query } from "../../lib/api.ts";
import { emptyTask, TaskFormModal, taskInput } from "./forms.tsx";
import { StatusBadge, useRequestId } from "./shared.tsx";
import { TagFilter } from "../tags/TagPicker.tsx";
import { useActivityList } from "./useActivityList.ts";
import { EntityPicker } from "../entity/EntityPicker.tsx";

const KIND_FILTERS = [["", "전체"], ["once", taskLabels.once], ["recurring", taskLabels.recurring]] as const;
const STATUS_BY_KIND: Record<string, readonly string[]> = {
  "": ["open", "done", "active", "stopped"],
  once: ["open", "done"],
  recurring: ["active", "stopped"],
};

export function TasksPage() {
  const [params, setParams] = useSearchParams();
  const kind = params.get("kind") ?? "";
  const status = params.get("status") ?? "";
  const tag_id=params.get("tag_id")??"";
  const entity_id=params.get("entity_id")??"";
  const list = useActivityList<TaskListItem>("tasks", `/tasks${query({ kind, status, tag_id, entity_id, limit: 20 })}`,
    "tasks-title", "할 일을 불러오지 못했습니다. 다시 시도하세요.");
  const { items, cursor, error, busy: loadingMore, more } = list;
  const [creating, setCreating] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const requestId = useRequestId();
  const navigate = useNavigate();

  const setFilter = (key: "kind" | "status" | "tag_id" | "entity_id", value: string) => {
    const next = new URLSearchParams(params);
    next.delete("pages"); next.delete("scroll");
    if (value) next.set(key, value);
    else next.delete(key);
    if (key === "kind" && status && !STATUS_BY_KIND[value].includes(status)) next.delete("status");
    setParams(next, { replace: true });
  };

  const filtered = Boolean(kind || status || tag_id || entity_id);

  return (
    <section className="panel" aria-labelledby="tasks-title">
      <div className="panel-head">
        <h1 id="tasks-title" className="page-title" tabIndex={-1}>할 일</h1>
        <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>할 일 추가</button>
      </div>

      <div className="form" role="group" aria-label="할 일 필터">
        <TagFilter value={tag_id} onChange={id=>setFilter("tag_id",id)}/>
        <EntityPicker label="엔터티 필터" value={entity_id} onChange={id=>setFilter("entity_id",id??"")}/>
        <div className="chips" role="group" aria-label={taskLabels.kind}>
          {KIND_FILTERS.map(([v, label]) => (
            <button key={v} type="button" className="chip" aria-pressed={kind === v} onClick={() => setFilter("kind", v)}>
              {label}
            </button>
          ))}
        </div>
        <div className="chips" role="group" aria-label={taskLabels.status}>
          <button type="button" className="chip" aria-pressed={!status} onClick={() => setFilter("status", "")}>모든 상태</button>
          {STATUS_BY_KIND[kind].map((s) => (
            <button key={s} type="button" className="chip" aria-pressed={status === s} onClick={() => setFilter("status", s)}>
              {taskLabels[s as keyof typeof taskLabels] as string}
            </button>
          ))}
        </div>
      </div>

      {error && <><Notice kind="error">{error}</Notice><button type="button" className="btn" onClick={list.retry}>다시 시도</button></>}
      {items === null && !error && <p className="secondary" role="status">불러오는 중…</p>}
      {items?.length === 0 && (
        <div className="empty">
          {filtered
            ? (
              <>
                <p className="secondary" style={{ margin: 0 }}>조건에 맞는 할 일이 없습니다.</p>
                <button type="button" className="btn" onClick={() => setParams(new URLSearchParams(), { replace: true })}>
                  필터 해제
                </button>
              </>
            )
            : <p className="secondary" style={{ margin: 0 }}>아직 할 일이 없습니다. 앞으로 할 일을 추가하세요.</p>}
        </div>
      )}
      {items && items.length > 0 && (
        <ul className="list">
          {items.map((t) => (
            <li key={t.id} className="list-item">
              <div className="list-item-main">
                <Link className="item-title" {...list.link(t.id)}>{t.title}</Link>
                <span className="secondary">{t.summary}</span>
                <span className="meta">
                  {taskLabels[t.kind]}
                  {t.due_on ? ` · 기한 ${t.due_on}` : ""}
                </span>
              </div>
              <StatusBadge status={t.status} />
            </li>
          ))}
        </ul>
      )}
      {cursor && (
        <button type="button" className="btn" onClick={more} disabled={loadingMore}>
          {loadingMore ? "불러오는 중…" : "더 보기"}
        </button>
      )}

      {creating && (
        <TaskFormModal
          key={formKey}
          mode="create"
          open={creating}
          initial={emptyTask()}
          onClose={() => setCreating(false)}
          onSave={async (draft) => {
            const created = await api<TaskResult>("POST", "/tasks", { ...taskInput(draft), request_id: requestId.current });
            requestId.renew();
            setCreating(false);
            setFormKey((k) => k + 1);
            navigate(`/tasks/${created.id}`);
          }}
        />
      )}
    </section>
  );
}

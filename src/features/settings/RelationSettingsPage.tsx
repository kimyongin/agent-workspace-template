import { useCallback, useEffect, useRef, useState } from "react";
import { useBlocker, useSearchParams } from "react-router";
import type { EntityRelationDefinition, EntityRelationDefinitionPage } from "@contracts/entity-relation.ts";
import { api, query } from "../../lib/api.ts";
import { Field } from "../../components/Field.tsx";
import { ConfirmDialog } from "../../components/Modal.tsx";
import { BodyAction } from "../../components/BodyAction.tsx";
import { useEntityTypes } from "../entity/useEntityTypes.ts";
import { MaterialSettingsHeading } from "./MaterialSettingsHeading.tsx";
import { IssuerRow } from "./IssuerRow.tsx";
import { RelationDefinitionForm } from "./RelationDefinitionForm.tsx";
import "./settings.css";
export function RelationSettingsPage() {
  const [params, setParams] = useSearchParams(), typeId = params.get("type_id") ?? "";
  const [q, setQ] = useState(""),
    [archived, setArchived] = useState("active"),
    [revision, setRevision] = useState(0),
    [page, setPage] = useState<EntityRelationDefinitionPage>({ items: [], next_cursor: null }),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [edit, setEdit] = useState<EntityRelationDefinition | "new" | null>(null),
    [formState, setFormState] = useState({ dirty: false, busy: false });
  const report = useCallback((s: { dirty: boolean; busy: boolean }) => setFormState(s), []),
    catalog = useEntityTypes(),
    types = catalog.types ?? [];
  const add = useRef<HTMLButtonElement>(null),
    returnFocus = useRef<HTMLElement | null>(null),
    request = useRef<AbortController | null>(null);
  const endpoint = `/entity-relation-definitions${query({ type_id: typeId, q, archived })}`;
  const blocked = useBlocker(formState.dirty || formState.busy);
  useEffect(() => {
    if (formState.busy && blocked.state === "blocked") blocked.reset();
  }, [formState.busy, blocked]);
  useEffect(() => {
    const unload = (e: BeforeUnloadEvent) => {
      if (formState.dirty || formState.busy) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", unload);
    return () => window.removeEventListener("beforeunload", unload);
  }, [formState]);
  useEffect(() => {
    const c = new AbortController();
    request.current = c;
    setLoading(true);
    setError("");
    void api<EntityRelationDefinitionPage>("GET", endpoint, undefined, c.signal).then((result) => {
      if (!c.signal.aborted) setPage(result);
    }).catch((e) => {
      if (!c.signal.aborted) setError(e.message);
    }).finally(() => {
      if (!c.signal.aborted) setLoading(false);
    });
    return () => c.abort();
  }, [endpoint, revision]);
  const close = () => {
    setEdit(null);
    setFormState({ dirty: false, busy: false });
    requestAnimationFrame(() => {
      if (returnFocus.current?.isConnected) returnFocus.current.focus();
      else add.current?.focus();
    });
  };
  const open = (row: EntityRelationDefinition | "new") => {
    returnFocus.current = document.activeElement as HTMLElement;
    setEdit(row);
    setMessage("");
  };
  const name = (id: string) => types.find((t) => t.id === id)?.label ?? id;
  const label = (row: EntityRelationDefinition) =>
    `${name(row.ends[0].type_id)} → ${row.ends[0].label} · ${row.ends[0].cardinality === "one" ? "하나만" : "여러 개"}`;
  const editor = (row?: EntityRelationDefinition) => (
    <RelationDefinitionForm
      original={row}
      types={types}
      onClose={close}
      onState={report}
      onSaved={() => {
        close();
        setMessage("연결 설정을 저장했습니다.");
        setRevision((n) => n + 1);
      }}
    />
  );
  return (
    <section className="panel settings material-settings" aria-label="연결 설정">
      <MaterialSettingsHeading section="relations" />
      <fieldset disabled={edit !== null} className="relation-settings-filters">
        <Field label="자료 종류 필터">
          {(props) => (
            <select
              className="input"
              {...props}
              value={typeId}
              onChange={(e) => setParams(e.target.value ? { type_id: e.target.value } : {})}
            >
              <option value="">모든 자료 종류</option>
              {types.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          )}
        </Field>
        <Field label="연결 이름 또는 자료 종류 검색">
          {(props) => (
            <input
              className="input"
              {...props}
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          )}
        </Field>
        <Field label="연결 설정 상태">
          {(props) => (
            <select
              className="input"
              {...props}
              value={archived}
              onChange={(e) => setArchived(e.target.value)}
            >
              <option value="active">사용 중</option>
              <option value="archived">보관</option>
              <option value="all">전체</option>
            </select>
          )}
        </Field>
      </fieldset>
      <div className="settings-inline-actions">
        <button
          className="body-action"
          type="button"
          ref={add}
          disabled={edit !== null || !catalog.types}
          onClick={() => open("new")}
        >
          연결 설정 추가
        </button>
      </div>
      {catalog.error && (
        <div role="alert" className="notice notice-error">
          자료 종류를 읽지 못했습니다. <BodyAction onClick={catalog.retry}>다시 조회</BodyAction>
        </div>
      )}
      {loading && <p role="status">불러오는 중…</p>}
      {error && (
        <div className="notice notice-error" role="alert">
          {error}
          <BodyAction onClick={() => setRevision((n) => n + 1)}>다시 조회</BodyAction>
        </div>
      )}
      {message && <p role="status">{message}</p>}
      <div className="issuer-registry-list">
        {edit === "new" && <IssuerRow label="새 연결 설정" open onToggle={() => {}}>{editor()}</IssuerRow>}
        {page.items.map((row) => (
          <IssuerRow
            key={row.id}
            label={label(row)}
            summary={`${name(row.ends[1].type_id)} → ${row.ends[1].label} · ${
              row.ends[1].cardinality === "one" ? "하나만" : "여러 개"
            }${row.archived ? " · 보관" : ""}`}
            open={edit !== null && edit !== "new" && edit.id === row.id}
            onToggle={() => {
              if (edit === null) open(row);
            }}
          >
            {edit !== null && edit !== "new" && edit.id === row.id && editor(row)}
          </IssuerRow>
        ))}
      </div>
      {!loading && !error && page.items.length === 0 && edit === null && (
        <p className="secondary">조건에 맞는 연결 설정이 없습니다.</p>
      )}
      {page.next_cursor && (
        <BodyAction
          disabled={loading || edit !== null}
          onClick={async () => {
            setLoading(true);
            setError("");
            const c = request.current;
            try {
              const next = await api<EntityRelationDefinitionPage>(
                "GET",
                `${endpoint}&cursor=${encodeURIComponent(page.next_cursor!)}`,
                undefined,
                c?.signal,
              );
              if (!c?.signal.aborted) {
                setPage((old) => ({ items: [...old.items, ...next.items], next_cursor: next.next_cursor }));
              }
            } catch (e) {
              if (!c?.signal.aborted) {
                setError(e instanceof Error ? e.message : "더 읽지 못했습니다.");
              }
            } finally {
              if (!c?.signal.aborted) setLoading(false);
            }
          }}
        >
          더 보기
        </BodyAction>
      )}
      <ConfirmDialog
        open={!formState.busy && blocked.state === "blocked"}
        title="변경을 버릴까요?"
        message="저장하지 않은 연결 설정이 사라집니다."
        confirmLabel="이동"
        onConfirm={() => {
          if (blocked.state === "blocked") blocked.proceed();
        }}
        onCancel={() => {
          if (blocked.state === "blocked") blocked.reset();
        }}
      />
    </section>
  );
}

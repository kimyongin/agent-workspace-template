import { WorkspaceSettingsBoundary, useSettingsAccess } from "./workspace-settings-access.tsx";
import { useApi } from "../../lib/api-context.tsx";
import { CollectionList } from "../../components/Collection.tsx";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { FieldSet } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "../../components/ui/native-select.tsx";
import { Input } from "../../components/ui/input.tsx";
import { Button } from "../../components/ui/button.tsx";
import { usePageNavigationBlocker } from "../details/workspace-context.ts";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "../../lib/workspace-router.tsx";
import type { EntityRelationDefinition, EntityRelationDefinitionPage } from "@contracts/entity-relation.ts";
import { query } from "../../lib/api.ts";
import { Field } from "../../components/Field.tsx";
import { ConfirmDialog } from "../../components/Modal.tsx";

import { useEntityTypes } from "../entity/useEntityTypes.ts";
import { MaterialSettingsHeading } from "./MaterialSettingsHeading.tsx";
import { IssuerRow } from "./IssuerRow.tsx";
import { RelationDefinitionForm } from "./RelationDefinitionForm.tsx";
export function RelationSettingsPage() {
  return <WorkspaceSettingsBoundary><RelationSettingsPageContent /></WorkspaceSettingsBoundary>;
}
function RelationSettingsPageContent() {
  const { canWrite } = useSettingsAccess();
  const api = useApi();
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
  const blocked = usePageNavigationBlocker(formState.dirty, formState.busy);
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
    <section className="min-w-0 flex w-full flex-col gap-6 max-w-6xl" aria-label="연결 설정">
      <MaterialSettingsHeading section="relations" />
      <FieldSet disabled={edit !== null} className="flex min-w-0 flex-wrap gap-3 [&>div]:min-w-40 [&>div]:flex-1">
        <Field label="자료 종류 필터">
          {(props) => (
            <NativeSelect

              {...props}
              value={typeId}
              onChange={(e) => setParams(e.target.value ? { type_id: e.target.value } : {})}
            >
              <NativeSelectOption value="">모든 자료 종류</NativeSelectOption>
              {types.map((t) => <NativeSelectOption key={t.id} value={t.id}>{t.label}</NativeSelectOption>)}
            </NativeSelect>
          )}
        </Field>
        <Field label="연결 이름 또는 자료 종류 검색">
          {(props) => (
            <Input

              {...props}
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          )}
        </Field>
        <Field label="연결 설정 상태">
          {(props) => (
            <NativeSelect

              {...props}
              value={archived}
              onChange={(e) => setArchived(e.target.value)}
            >
              <NativeSelectOption value="active">사용 중</NativeSelectOption>
              <NativeSelectOption value="archived">보관</NativeSelectOption>
              <NativeSelectOption value="all">전체</NativeSelectOption>
            </NativeSelect>
          )}
        </Field>
      </FieldSet>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="outline"

          type="button"
          ref={add}
          disabled={!canWrite || edit !== null || !catalog.types}
          onClick={() => open("new")}
        >
          연결 설정 추가
        </Button>
      </div>
      {catalog.error && (
        <Alert variant="destructive" role="alert"><AlertDescription>
          자료 종류를 읽지 못했습니다. <Button variant="ghost" type="button" onClick={catalog.retry}>다시 조회</Button>
        </AlertDescription></Alert>
      )}
      {loading && <Alert role="status"><AlertDescription>불러오는 중…</AlertDescription></Alert>}
      {error && (
        <Alert variant="destructive" role="alert"><AlertDescription>
          {error}
          <Button variant="ghost" type="button" onClick={() => setRevision((n) => n + 1)}>다시 조회</Button>
        </AlertDescription></Alert>
      )}
      {message && <Alert role="status"><AlertDescription>{message}</AlertDescription></Alert>}
      <CollectionList view="table" label="연결 설정 목록" columns={["연결 설정", "설정 요약"]}>
        {edit === "new" && <IssuerRow label="새 연결 설정" open>{editor()}</IssuerRow>}
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
      </CollectionList>
      {!loading && !error && page.items.length === 0 && edit === null && (
        <p className="text-sm text-muted-foreground">조건에 맞는 연결 설정이 없습니다.</p>
      )}
      {page.next_cursor && (
        <Button variant="ghost" type="button"
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
        </Button>
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

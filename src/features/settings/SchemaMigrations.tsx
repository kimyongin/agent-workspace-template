import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useBlocker, useParams } from "react-router";
import type { EntitySchemaVersion, EntityType } from "@contracts/entity-type.ts";
import { ConfirmDialog } from "../../components/Modal.tsx";
import { api } from "../../lib/api.ts";
import { SchemaEditor } from "./SchemaEditor.tsx";
import { EntityTypeIcon } from "../entity/EntityTypeIcon.tsx";
export function SchemaMigrations() {
  const { type_id } = useParams();
  const [type, setType] = useState<EntityType>(),
    [definition, setDefinition] = useState<EntitySchemaVersion>(),
    [error, setError] = useState("");
  const [protectedDraft, setProtectedDraft] = useState(false);
  const state = useCallback(
    (s: { dirty: boolean; busy: boolean; uncertain: boolean }) => setProtectedDraft(s.dirty || s.busy || s.uncertain),
    [],
  );
  const blocker = useBlocker(protectedDraft);
  const pending = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setError("");
    try {
      const [t, d] = await Promise.all([
        api<EntityType>("GET", `/entity-types/${type_id}`, undefined, controller.signal),
        api<EntitySchemaVersion>("GET", `/entity-types/${type_id}/schema`, undefined, controller.signal),
      ]);
      if (controller.signal.aborted) return;
      setType(t);
      setDefinition(d);
    } catch (e) {
      if (controller.signal.aborted) return;
      throw e;
    }
  }, [type_id]);
  useEffect(() => {
    setType(undefined);
    setDefinition(undefined);
    void load().catch((e) => {
      if (!pending.current?.signal.aborted) setError(e.message);
    });
    return () => pending.current?.abort();
  }, [load]);
  useEffect(() => {
    const unload = (e: BeforeUnloadEvent) => {
      if (protectedDraft) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", unload);
    return () => window.removeEventListener("beforeunload", unload);
  }, [protectedDraft]);
  return (
    <section className="panel settings">
      <h1 className="page-title">
        {type && <EntityTypeIcon id={type.icon_id} />} {type?.label ?? "자료 종류"} · 값 변환 준비
      </h1>
      <nav aria-label="자료 종류 설정">
        <Link to={`/settings/entity-types/${type_id}`}>속성·표시로 돌아가기</Link>
      </nav>
      <p className="secondary">변경안과 영향 분석을 저장합니다. 현재 자료 값과 활성 정의는 분석으로 바뀌지 않습니다.</p>
      <ConfirmDialog
        open={blocker.state === "blocked"}
        title="변경을 버릴까요?"
        message="저장하지 않은 변환 준비가 사라집니다."
        confirmLabel="이동"
        onConfirm={() => {
          if (blocker.state === "blocked") blocker.proceed();
        }}
        onCancel={() => {
          if (blocker.state === "blocked") blocker.reset();
        }}
      />
      {error && (
        <>
          <p role="alert">{error}</p>
          <button className="btn" onClick={() => void load().catch((e) => setError(e.message))}>조회 다시 시도</button>
        </>
      )}
      {type && type.id === type_id && definition && (
        <SchemaEditor key={type_id} type={type} definition={definition} onApplied={load} onState={state} />
      )}
    </section>
  );
}

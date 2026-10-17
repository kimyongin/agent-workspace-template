import { useEffect, useRef, useState } from "react";
import type { EntityRelationDefinition, EntityRelationEnd } from "@contracts/entity-relation.ts";
import { relationDefinitionCreate } from "@contracts/entity-relation.ts";
import type { EntityType } from "@contracts/entity-type.ts";
import { api, ApiError } from "../../lib/api.ts";
import { useWriteAttempt, writeErrorMessage } from "../../lib/write-attempt.ts";
import { Field } from "../../components/Field.tsx";
import { ConfirmDialog } from "../../components/Modal.tsx";
import { BodyAction } from "../../components/BodyAction.tsx";
export function RelationDefinitionForm(
  { original, types, onClose, onSaved, onState }: {
    original?: EntityRelationDefinition;
    types: EntityType[];
    onClose: () => void;
    onSaved: () => void;
    onState: (s: { dirty: boolean; busy: boolean }) => void;
  },
) {
  const [baseline, setBaseline] = useState(original),
    [ends, setEnds] = useState<EntityRelationDefinition["ends"]>(() =>
      original?.ends ??
        [{ type_id: "", label: "", cardinality: "many" }, { type_id: "", label: "", cardinality: "many" }]
    ),
    [archived, setArchived] = useState(original?.archived ?? false);
  const [error, setError] = useState(""),
    [conflict, setConflict] = useState(false),
    [latest, setLatest] = useState<EntityRelationDefinition | null>(null),
    [reading, setReading] = useState(false),
    [confirm, setConfirm] = useState<"cancel" | "delete" | null>(null);
  const writing = useWriteAttempt(), [operation, setOperation] = useState("save");
  const dirty = JSON.stringify(ends) !==
      JSON.stringify(
        baseline?.ends ??
          [{ type_id: "", label: "", cardinality: "many" }, { type_id: "", label: "", cardinality: "many" }],
      ) || archived !== (baseline?.archived ?? false);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    form.current?.querySelector<HTMLSelectElement>("select")?.focus();
  }, []);
  useEffect(() => {
    onState({ dirty: dirty || writing.uncertain, busy: writing.busy || reading });
  }, [dirty, writing.uncertain, writing.busy, reading, onState]);
  useEffect(() => () => onState({ dirty: false, busy: false }), [onState]);
  const fail = (e: unknown) => {
    setConflict(e instanceof ApiError && e.code === "settings_changed");
    setError(writeErrorMessage(e));
  };
  const save = async () => {
    if (writing.busy || reading || conflict) return;
    if (!writing.uncertain && !relationDefinitionCreate.safeParse({ ends }).success) {
      setError("양쪽 자료 종류와 연결 이름을 입력하세요.");
      return;
    }
    setError("");
    setOperation("save");
    try {
      await writing.attempt.run(async () => {
        await api(
          baseline ? "PATCH" : "POST",
          `/entity-relation-definitions${baseline ? `/${baseline.id}` : ""}`,
          baseline ? { ends, archived, expected_version: baseline.version } : { ends },
          undefined,
          writing.attempt.requestKey(),
        );
        onSaved();
      });
    } catch (e) {
      fail(e);
    }
  };
  const remove = async () => {
    if (!baseline) return;
    setConfirm(null);
    setError("");
    setOperation("delete");
    try {
      await writing.attempt.run(async () => {
        await api(
          "DELETE",
          `/entity-relation-definitions/${baseline.id}`,
          { expected_version: baseline.version },
          undefined,
          writing.attempt.requestKey(),
        );
        onSaved();
      });
    } catch (e) {
      fail(e);
    }
  };
  const change = (side: number, patch: Partial<EntityRelationEnd>) =>
    setEnds((old) => old.map((end, n) => n === side ? { ...end, ...patch } : end) as EntityRelationDefinition["ends"]);
  return (
    <form
      className="relation-definition-form"
      ref={form}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <p className="secondary">
        자료는 연결 없이도 작성할 수 있습니다.
      </p>
      <fieldset disabled={writing.busy || writing.uncertain || reading} className="relation-definition-ends">
        {ends.map((end, n) => {
          const prefix = n === 0 ? "첫 번째" : "두 번째";
          return (
            <div className="relation-definition-end" key={n}>
              <h3>{types.find((type) => type.id === end.type_id)?.label ?? `${prefix} 자료`}에서 보이는 연결</h3>
              <Field label="자료 종류" required>
                {(props) => (
                  <select
                    className="input"
                    {...props}
                    aria-label={`${prefix} 자료 종류`}
                    value={end.type_id}
                    onChange={(e) => change(n, { type_id: e.target.value })}
                  >
                    <option value="">종류 선택</option>
                    {types.filter((t) => !t.archived || t.id === end.type_id).map((t) => (
                      <option key={t.id} value={t.id}>{t.label}{t.archived ? " (보관)" : ""}</option>
                    ))}
                  </select>
                )}
              </Field>
              <Field label="연결 이름" required help="이 자료에서 상대를 부르는 이름입니다.">
                {(props) => (
                  <input
                    className="input"
                    {...props}
                    aria-label={`${prefix} 연결 이름`}
                    value={end.label}
                    maxLength={100}
                    onChange={(e) => change(n, { label: e.target.value })}
                  />
                )}
              </Field>
              <Field label="연결 개수" help="몇 개까지 연결할 수 있는지 정합니다.">
                {(props) => (
                  <select
                    className="input"
                    {...props}
                    aria-label={`${prefix} 연결 개수`}
                    value={end.cardinality}
                    onChange={(e) => change(n, { cardinality: e.target.value as "one" | "many" })}
                  >
                    <option value="one">하나만</option>
                    <option value="many">여러 개</option>
                  </select>
                )}
              </Field>
            </div>
          );
        })}
      </fieldset>
      {baseline && (
        <label className="check-label">
          <input
            type="checkbox"
            checked={archived}
            disabled={writing.busy || writing.uncertain || reading}
            onChange={(e) => setArchived(e.target.checked)}
          />보관<span className="secondary">기존 연결을 유지하고 새 연결을 중단합니다.</span>
        </label>
      )}
      {error && (
        <div className="notice notice-error" role="alert">
          {error}
          {conflict && baseline && (
            <BodyAction
              disabled={reading}
              onClick={async () => {
                setReading(true);
                try {
                  setLatest(await api("GET", `/entity-relation-definitions/${baseline.id}`));
                } catch (e) {
                  fail(e);
                } finally {
                  setReading(false);
                }
              }}
            >
              최신 버전 확인
            </BodyAction>
          )}
        </div>
      )}
      {latest && (
        <div className="notice">
          <p>
            최신 버전 {latest.version}: {latest.ends.map((e) => e.label).join(" ↔ ")}
            {latest.archived ? " · 보관" : ""}. 내 입력은 유지됩니다.
          </p>
          <BodyAction
            onClick={() => {
              setBaseline(latest);
              setLatest(null);
              setConflict(false);
              setError("");
            }}
          >
            내 입력으로 다시 검토
          </BodyAction>
          <BodyAction
            onClick={() => {
              setBaseline(latest);
              setEnds(latest.ends);
              setArchived(latest.archived);
              setLatest(null);
              setConflict(false);
              setError("");
            }}
          >
            최신 값 사용
          </BodyAction>
        </div>
      )}
      <div className="actions">
        {baseline && (
          <button
            className="btn btn-danger"
            type="button"
            disabled={writing.busy || reading || conflict || writing.uncertain && operation !== "delete"}
            onClick={() => writing.uncertain ? void remove() : setConfirm("delete")}
          >
            {writing.uncertain && operation === "delete" ? "같은 삭제 다시 확인" : "삭제"}
          </button>
        )}
        <button
          className="btn"
          type="button"
          disabled={writing.busy || writing.uncertain || reading}
          onClick={() => dirty ? setConfirm("cancel") : onClose()}
        >
          취소
        </button>
        <button
          className="btn btn-primary"
          type="submit"
          disabled={writing.busy || reading || conflict || writing.uncertain && operation !== "save" ||
            !!baseline && !dirty && !writing.uncertain}
        >
          {writing.busy ? "처리 중…" : writing.uncertain ? "같은 저장 다시 확인" : baseline ? "저장" : "추가"}
        </button>
      </div>
      <ConfirmDialog
        open={confirm !== null}
        title={confirm === "delete" ? "관계를 삭제할까요?" : "변경을 버릴까요?"}
        message={confirm === "delete"
          ? "연결이 있는 관계는 삭제할 수 없습니다. 기존 연결을 유지하려면 보관하세요."
          : "저장하지 않은 연결 설정이 사라집니다."}
        confirmLabel={confirm === "delete" ? "삭제" : "버리기"}
        onConfirm={() => confirm === "delete" ? void remove() : onClose()}
        onCancel={() => setConfirm(null)}
      />
    </form>
  );
}

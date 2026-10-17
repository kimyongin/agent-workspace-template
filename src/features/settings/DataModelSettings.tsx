import { useEffect, useRef, useState } from "react";
import { Link, useBlocker } from "react-router";
import type { DataModelDocument, ModelChange, ModelReview } from "@contracts/data-model.ts";
import { useAuth } from "../auth/AuthProvider.tsx";
import { invalidateEntityTypeCatalog } from "../entity/entity-type-catalog.ts";
import { api, ApiError } from "../../lib/api.ts";
import { useWriteAttempt, writeErrorMessage } from "../../lib/write-attempt.ts";
import { Field } from "../../components/Field.tsx";
import { SettingsHeading } from "./SettingsHeading.tsx";
import { MaterialSettingsSection } from "./MaterialSettingsSection.tsx";
import { ConfirmDialog } from "../../components/Modal.tsx";
import { IssuerRow } from "./IssuerRow.tsx";
import { schemaDiffLabel, schemaDiffValueLabel } from "./schema-labels.ts";
import "./settings.css";

const labels = {
  new: "추가",
  unchanged: "변경 없음",
  compatible: "수정",
  migration_required: "값 변환 필요",
  conflict: "충돌",
};
const states = {
  ready: "적용 준비됨",
  needs_conversion: "값 변환 필요",
  applied: "전체 적용 완료",
  cancelled: "취소됨",
};

export function DataModelReview({ review, removeKeys = {}, onConfirmRemoval, disabled = false }: {
  review: ModelReview;
  removeKeys?: Record<string, string[]>;
  onConfirmRemoval?: (ref: string, confirmed: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <section aria-label="전체 모델 검토" className="settings-fields">
      <h3 className="section-title">{review.title}</h3>
      <div className="issuer-registry-list">
        {review.items.map((item) => (
          <ReviewRow
            key={item.ref}
            item={item}
            confirmed={!!removeKeys[item.ref]}
            onConfirmRemoval={onConfirmRemoval}
            disabled={disabled}
          />
        ))}
      </div>
      {!review.can_apply && (
        <p className="help">
          충돌 또는 값 변환이 필요한 항목을 확인하세요. 일부 항목만 적용하지 않습니다.
        </p>
      )}
    </section>
  );
}
function ReviewRow({ item, confirmed, onConfirmRemoval, disabled }: {
  item: ModelReview["items"][number];
  confirmed: boolean;
  onConfirmRemoval?: (ref: string, confirmed: boolean) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <IssuerRow
      label={item.label}
      summary={`${labels[item.kind]}${item.removed_keys?.length ? " · 항목 제거 확인" : ""}${
        item.source_is_stale ? " · 원본 버전 다름" : ""
      }`}
      open={open}
      onToggle={() => setOpen(!open)}
    >
      {item.message && <p>{item.message}</p>}
      {(item.source_schema_version !== undefined || item.current_schema_version !== undefined) && (
        <p className="help">
          파일 원본 버전 {item.source_schema_version ?? "기록 없음"} · 현재 버전{" "}
          {item.current_schema_version ?? "새 종류"} · 적용 버전 {item.target_schema_version ?? "유지"}
        </p>
      )}
      {item.source_is_stale && (
        <p className="help">
          파일 원본 버전이 현재 게시 버전과 다릅니다. 현재 정의와 비교한 아래 변경을 확인하세요. 파일 원본 버전은
          덮어쓰기 권한이 아닙니다.
        </p>
      )}
      {!!item.removed_keys?.length && (
        <div>
          <p className="help">
            파일에서 빠진 항목:{" "}
            {item.removed_keys.map((key) =>
              item.current_schema?.properties[key]?.title ?? item.schema?.properties[key]?.title ?? key
            ).join(", ")}
          </p>
          {onConfirmRemoval && (
            <label className="choice-control">
              <input
                type="checkbox"
                checked={confirmed}
                disabled={disabled}
                onChange={(e) => onConfirmRemoval(item.ref, e.target.checked)}
              />
              {item.label}의 {item.removed_keys.map((key) =>
                item.current_schema?.properties[key]?.title ?? item.schema?.properties[key]?.title ?? key
              ).join(", ")} 항목 영구 제거 확인
            </label>
          )}
        </div>
      )}
      {item.diff.length > 0 && (
        <dl className="schema-change-list">
          {item.diff.map((d, i) => (
            <div key={i}>
              <dt>
                {item.schema
                  ? schemaDiffLabel(d.path, { schema: item.schema }, { schema: item.current_schema ?? item.schema })
                  : d.path}
              </dt>
              <dd>
                {d.before_present
                  ? item.schema
                    ? schemaDiffValueLabel(d.path, d.before, { schema: item.current_schema ?? item.schema })
                    : JSON.stringify(d.before)
                  : "설정 안 함"} → {d.after_present
                  ? item.schema
                    ? schemaDiffValueLabel(d.path, d.after, { schema: item.schema })
                    : JSON.stringify(d.after)
                  : "설정 안 함"}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </IssuerRow>
  );
}

export function DataModelSettings() {
  const { session } = useAuth();
  const [document, setDocument] = useState(""),
    [mode, setMode] = useState<"update" | "copy">("update");
  const [review, setReview] = useState<ModelReview | null>(null),
    [changes, setChanges] = useState<ModelChange[]>([]);
  const [selected, setSelected] = useState<string | null>(null),
    [accepted, setAccepted] = useState("");
  const [error, setError] = useState(""),
    [fields, setFields] = useState<ApiError["fields"]>([]);
  const [historyError, setHistoryError] = useState(""),
    [loading, setLoading] = useState(true);
  const [reading, setReading] = useState(false),
    [fileName, setFileName] = useState("");
  const [notice, setNotice] = useState("");
  const [removeKeys, setRemoveKeys] = useState<Record<string, string[]>>({});
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [detailState, setDetailState] = useState<Record<string, { loading: boolean; error: string }>>({});
  const failedCursor = useRef<string | undefined>(undefined);
  const detailRequests = useRef(new Map<string, AbortController>());
  const historyRequest = useRef<AbortController | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const { attempt, busy, uncertain } = useWriteAttempt();
  const alive = useRef(true),
    file = useRef<HTMLInputElement>(null),
    sequence = useRef(0);
  const readRequest = useRef<AbortController | null>(null);
  const locked = busy || uncertain || reading;
  const dirty = document !== accepted;
  const missingRemovalConfirmation = !!review?.items.some((item) =>
    item.removed_keys?.length &&
    (removeKeys[item.ref]?.length !== item.removed_keys.length ||
      item.removed_keys.some((key) => !removeKeys[item.ref].includes(key)))
  );
  const blocker = useBlocker(dirty || busy || uncertain || reading);
  useEffect(() => {
    if ((busy || reading) && blocker.state === "blocked") blocker.reset();
  }, [busy, reading, blocker]);
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => {
      if (dirty || busy || uncertain || reading) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", unload);
    return () => window.removeEventListener("beforeunload", unload);
  }, [dirty, busy, uncertain, reading]);
  useEffect(() => () => {
    alive.current = false;
    readRequest.current?.abort();
    sequence.current++;
    historyRequest.current?.abort();
    for (const request of detailRequests.current.values()) request.abort();
  }, []);
  const history = async (signal?: AbortSignal, cursor?: string) => {
    historyRequest.current?.abort();
    const controller = new AbortController();
    historyRequest.current = controller;
    const cancel = () => controller.abort();
    signal?.addEventListener("abort", cancel, { once: true });
    setLoading(true);
    setHistoryError("");
    failedCursor.current = cursor;
    try {
      const value = await api<{ items: ModelChange[]; next_cursor: string | null }>(
        "GET",
        `/data-model/changes${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
        undefined,
        controller.signal,
      );
      if (alive.current && !controller.signal.aborted) {
        setChanges((list) =>
          cursor
            ? [...list, ...value.items.filter((item) => !list.some((existing) => existing.id === item.id))]
            : value.items
        );
        setNextCursor(value.next_cursor);
      }
    } catch (e) {
      if (alive.current && !controller.signal.aborted) {
        setHistoryError(e instanceof ApiError ? e.message : "변경 이력을 읽지 못했습니다.");
      }
    } finally {
      signal?.removeEventListener("abort", cancel);
      if (alive.current && !controller.signal.aborted) setLoading(false);
    }
  };
  const loadDetail = async (id: string) => {
    detailRequests.current.get(id)?.abort();
    const controller = new AbortController();
    detailRequests.current.set(id, controller);
    setDetailState((state) => ({ ...state, [id]: { loading: true, error: "" } }));
    try {
      const value = await api<ModelChange>("GET", `/data-model/changes/${id}`, undefined, controller.signal);
      if (alive.current && !controller.signal.aborted) {
        setChanges((list) => list.map((item) => item.id === id && value.version >= item.version ? value : item));
      }
    } catch (e) {
      if (alive.current && !controller.signal.aborted) {
        setDetailState((state) => ({
          ...state,
          [id]: { loading: false, error: e instanceof ApiError ? e.message : "상세를 읽지 못했습니다." },
        }));
        return;
      }
    } finally {
      if (detailRequests.current.get(id) === controller) detailRequests.current.delete(id);
    }
    if (alive.current && !controller.signal.aborted) {
      setDetailState((state) => ({ ...state, [id]: { loading: false, error: "" } }));
    }
  };
  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    void history(controller.signal);
    return () => controller.abort();
  }, []);
  const failure = (e: unknown) => {
    setError(writeErrorMessage(e));
    setFields(e instanceof ApiError ? e.fields : []);
  };
  const edit = (value: string) => {
    sequence.current++;
    readRequest.current?.abort();
    setDocument(value);
    setReview(null);
    setRemoveKeys({});
    setError("");
    setFields([]);
    setNotice("");
    attempt.reset();
  };
  const preview = async () => {
    if (locked || !document.trim()) return;
    const controller = new AbortController();
    readRequest.current = controller;
    const current = ++sequence.current;
    setReading(true);
    setError("");
    setFields([]);
    try {
      const value = await api<ModelReview>("POST", "/data-model/preview", {
        document,
        mode,
      }, controller.signal);
      if (alive.current && sequence.current === current) {
        setReview(value);
        setRemoveKeys({});
      }
    } catch (e) {
      if (alive.current && !controller.signal.aborted) failure(e);
    } finally {
      if (alive.current && sequence.current === current) setReading(false);
    }
  };
  const readFile = async (value?: File) => {
    if (!value || locked) return;
    const current = ++sequence.current;
    setReading(true);
    setError("");
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(
        await value.arrayBuffer(),
      );
      if (alive.current && current === sequence.current) {
        edit(text);
        setFileName(value.name);
      }
    } catch {
      if (alive.current) {
        setError(
          "UTF-8 JSON 파일을 읽지 못했습니다. 기존 입력은 유지했습니다.",
        );
      }
    } finally {
      if (alive.current) setReading(false);
    }
  };
  const publish = (value: ModelChange) => {
    historyRequest.current?.abort();
    setLoading(false);
    setChanges(
      (list) => [value, ...list.filter((item) => item.id !== value.id)],
    );
    setSelected(value.id);
    setAccepted(document);
    setReview(null);
  };
  const prepare = async () => {
    if (
      busy || reading || !review || !uncertain && missingRemovalConfirmation || uncertain && pendingAction !== "prepare"
    ) return;
    setPendingAction("prepare");
    const payload = { document, mode, preview_fingerprint: review.fingerprint, remove_keys: removeKeys };
    setError("");
    setFields([]);
    try {
      await attempt.run(async () => {
        const value = await api<ModelChange>(
          "POST",
          "/data-model/changes",
          payload,
          undefined,
          attempt.requestKey(),
        );
        if (alive.current) {
          publish(value);
          void loadDetail(value.id);
          setNotice(
            "전체 변경안을 저장했습니다. 아래 변경 이력에서 검토하고 적용하세요.",
          );
        }
      });
    } catch (e) {
      if (alive.current) failure(e);
    }
  };
  const apply = async (change: ModelChange) => {
    if (busy || reading || uncertain && pendingAction !== change.id) return;
    setPendingAction(change.id);
    setError("");
    setFields([]);
    try {
      await attempt.run(async () => {
        const value = await api<ModelChange>(
          "POST",
          `/data-model/changes/${change.id}/apply`,
          { expected_version: change.version },
          undefined,
          attempt.requestKey(),
        );
        if (alive.current) {
          publish(value);
          void loadDetail(value.id);
          setNotice(
            value.status === "applied" ? "전체 자료 모델을 적용했습니다." : "현재 변경안 상태를 확인하세요.",
          );
          if (session) invalidateEntityTypeCatalog(session.user.id);
        }
      });
    } catch (e) {
      if (alive.current) failure(e);
    }
  };
  const exportModel = async () => {
    if (locked) return;
    setReading(true);
    setError("");
    try {
      const result = await api<DataModelDocument>("GET", "/data-model/export");
      if (!alive.current) return;
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(result, null, 2) + "\n"], {
          type: "application/json",
        }),
      );
      const anchor = window.document.createElement("a");
      anchor.href = url;
      anchor.download = "workspace-data-model.json";
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      setNotice("전체 자료 모델 파일을 내보냈습니다.");
    } catch (e) {
      if (alive.current) failure(e);
    } finally {
      if (alive.current) setReading(false);
    }
  };
  return (
    <section className="panel settings">
      <SettingsHeading
        title="자료 모델"
        description="전체 자료 종류·관계·필요한 식별자 설정을 한 파일로 교환합니다."
      />
      {error && (
        <div role="alert" className="error-text">
          <p>{error}</p>
          {fields.length > 0 && (
            <ul>
              {fields.map((f, i) => <li key={i}>{f.path}: {f.message}</li>)}
            </ul>
          )}
        </div>
      )}
      {notice && <p role="status">{notice}</p>}
      <MaterialSettingsSection
        title="가져오기·내보내기"
        initialOpen
        state={{ dirty, busy: busy || reading, uncertain }}
      >
        <div className="settings-fields">
          <div>
            <button
              className="btn"
              disabled={locked}
              onClick={() => void exportModel()}
            >
              전체 모델 내보내기
            </button>
          </div>
          <p className="help">
            실제 자료와 개별 연결·기록은 포함하지 않습니다. 파일에 없는 정의도 삭제하지 않습니다.
          </p>
          <fieldset className="settings-fields" disabled={locked}>
            <Field label="가져오는 방법">
              {(props) => (
                <select
                  {...props}
                  className="input"
                  value={mode}
                  onChange={(e) => {
                    edit(document);
                    setMode(e.target.value as "update" | "copy");
                  }}
                >
                  <option value="update">기존 모델에 반영</option>
                  <option value="copy">새 자료 종류와 관계로 복사</option>
                </select>
              )}
            </Field>
            <Field label="JSON 파일">
              {(props) => (
                <div className="schema-import-file">
                  <input
                    {...props}
                    ref={file}
                    type="file"
                    accept=".json,application/json"
                    className="visually-hidden"
                    tabIndex={-1}
                    onChange={(e) => {
                      void readFile(e.target.files?.[0]);
                      e.target.value = "";
                    }}
                  />
                  <button
                    className="btn"
                    type="button"
                    onClick={() => file.current?.click()}
                  >
                    JSON 파일 선택
                  </button>
                  <span className="help">{fileName || "선택한 파일 없음"}</span>
                </div>
              )}
            </Field>
            <Field label="전체 모델 JSON">
              {(props) => (
                <textarea
                  {...props}
                  className="input schema-import-document"
                  rows={8}
                  value={document}
                  spellCheck={false}
                  onChange={(e) => edit(e.target.value)}
                />
              )}
            </Field>
          </fieldset>
          <div className="actions schema-actions">
            <button
              className="btn"
              disabled={locked || !document}
              onClick={() => {
                edit("");
                setAccepted("");
                setFileName("");
              }}
            >
              입력 비우기
            </button>
            <button
              className="btn btn-primary"
              disabled={locked || !document.trim()}
              onClick={() => void preview()}
            >
              {reading ? "읽는 중…" : "가져올 내용 검토"}
            </button>
          </div>
          {review && (
            <>
              <DataModelReview
                review={review}
                removeKeys={removeKeys}
                disabled={locked}
                onConfirmRemoval={(ref, confirmed) =>
                  setRemoveKeys((keys) => {
                    const next = { ...keys };
                    if (confirmed) {
                      next[ref] = [...(review.items.find((item) => item.ref === ref)?.removed_keys ?? [])];
                    } else delete next[ref];
                    return next;
                  })}
              />
              <div className="actions schema-actions">
                <button
                  className="btn btn-primary"
                  disabled={busy || reading ||
                    uncertain && pendingAction !== "prepare" ||
                    review.items.some((i) => i.kind === "conflict") || !uncertain && missingRemovalConfirmation}
                  onClick={() => void prepare()}
                >
                  {busy ? "저장 중…" : uncertain ? "같은 요청 다시 확인" : "검토한 전체 변경안 저장"}
                </button>
              </div>
            </>
          )}
        </div>
      </MaterialSettingsSection>
      <MaterialSettingsSection
        title="변경 이력"
        initialOpen
        summary={`${changes.length}개`}
      >
        <div className="settings-fields">
          <div className="actions">
            <button
              className="btn"
              disabled={locked || loading}
              onClick={() => void history()}
            >
              변경 이력 새로 읽기
            </button>
          </div>
          {loading && <p role="status">변경 이력을 읽는 중…</p>}
          {historyError && (
            <div role="alert">
              <p className="error-text">{historyError}</p>
              <button
                className="btn"
                disabled={locked}
                onClick={() => void history(undefined, failedCursor.current)}
              >
                변경 이력 다시 읽기
              </button>
            </div>
          )}
          {!loading && !historyError && changes.length === 0 && (
            <p className="help">저장된 전체 모델 변경안이 없습니다.</p>
          )}
          <div className="issuer-registry-list">
            {changes.map((change) => (
              <IssuerRow
                key={change.id}
                label={change.review.title}
                summary={states[change.status]}
                open={selected === change.id}
                onToggle={() => {
                  if (!locked) {
                    setSelected(
                      selected === change.id ? null : change.id,
                    );
                  }
                }}
              >
                <p className="help">
                  <time dateTime={change.created_at}>
                    {new Date(change.created_at).toLocaleString("ko-KR")}
                  </time>
                </p>
                {detailState[change.id]?.loading && <p role="status">변경안 상세를 읽는 중…</p>}
                {detailState[change.id]?.error && (
                  <div role="alert">
                    <p className="error-text">저장 결과는 유지했습니다. {detailState[change.id].error}</p>
                    <button className="btn" disabled={locked} onClick={() => void loadDetail(change.id)}>
                      상세 다시 조회
                    </button>
                  </div>
                )}
                <DataModelReview review={change.review} />
                {change.status === "needs_conversion" && (
                  <p className="help">
                    값 변환 준비가 필요합니다. 현재 모델은 유지됩니다.
                  </p>
                )}
                {change.status === "ready" && change.review.can_apply && (
                  <div className="actions">
                    <button
                      className="btn btn-primary"
                      disabled={busy || reading || detailState[change.id]?.loading || !!detailState[change.id]?.error ||
                        uncertain && pendingAction !== change.id}
                      onClick={() => void apply(change)}
                    >
                      {busy ? "적용 중…" : uncertain ? "같은 요청 다시 확인" : "전체 적용"}
                    </button>
                  </div>
                )}
                {change.result && (
                  <div>
                    <p role="status">
                      자료 종류 {change.result.type_ids.length}개 · 관계 {change.result.relation_ids.length}개 적용
                    </p>
                    <Link to="/settings/materials">자료 설정</Link> ·{" "}
                    <Link to="/settings/relations">자료 관계 설정</Link>
                  </div>
                )}
              </IssuerRow>
            ))}
          </div>
          {nextCursor && (
            <div className="actions">
              <button className="btn" disabled={locked || loading} onClick={() => void history(undefined, nextCursor)}>
                더 보기
              </button>
            </div>
          )}
        </div>
      </MaterialSettingsSection>
      <ConfirmDialog
        open={!busy && !reading && blocker.state === "blocked"}
        title="변경을 버릴까요?"
        message={uncertain
          ? "저장 여부를 먼저 확인하는 것이 좋습니다. 이동해도 처리 중인 요청이 취소되지는 않습니다."
          : "저장하지 않은 전체 모델 입력이 사라집니다."}
        confirmLabel="이동"
        onConfirm={() => {
          if (blocker.state === "blocked") blocker.proceed();
        }}
        onCancel={() => {
          if (blocker.state === "blocked") blocker.reset();
        }}
      />
    </section>
  );
}

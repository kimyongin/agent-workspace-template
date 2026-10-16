import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import type { EntitySchemaVersion, EntityType } from "@contracts/entity-type.ts";
import { entitySchemaImportLimits } from "@contracts/entity-schema-import.ts";
import type {
  EntitySchemaImportInput,
  EntitySchemaImportResult,
  EntitySchemaImportReview,
} from "@contracts/entity-schema-import.ts";
import { api, ApiError } from "../../lib/api.ts";
import { useWriteAttempt, writeErrorMessage } from "../../lib/write-attempt.ts";
import { BodyAction } from "../../components/BodyAction.tsx";
import { Field } from "../../components/Field.tsx";
import { type MaterialSectionState, MaterialSettingsSection } from "./MaterialSettingsSection.tsx";
import { schemaDiffLabel, schemaDiffValueLabel } from "./schema-labels.ts";

export function SchemaImport({ typeId, type, definition, disabled, blockedByDraft, onState, onPrepared }: {
  typeId?: string;
  type: EntityType | null;
  definition: EntitySchemaVersion | null;
  disabled: boolean;
  blockedByDraft: boolean;
  onState: (state: MaterialSectionState) => void;
  onPrepared: (result: EntitySchemaImportResult) => void;
}) {
  const [mode, setMode] = useState<"update" | "copy">(typeId ? "update" : "copy");
  const [document, setDocument] = useState("");
  const [fileName, setFileName] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const [acceptedDocument, setAcceptedDocument] = useState("");
  const [comparisonDefinition, setComparisonDefinition] = useState(definition);
  const [expectedVersion, setExpectedVersion] = useState(definition?.schema_version);
  const [newKeys, setNewKeys] = useState<string[]>([]);
  const [removeAcknowledged, setRemoveAcknowledged] = useState(false);
  const [review, setReview] = useState<EntitySchemaImportReview | null>(null);
  const [result, setResult] = useState<EntitySchemaImportResult | null>(null);
  const [readBusy, setReadBusy] = useState(false);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState("");
  const [fields, setFields] = useState<ApiError["fields"]>([]);
  const [message, setMessage] = useState("");
  const { attempt, busy, uncertain } = useWriteAttempt();
  const alive = useRef(true), reads = useRef({ epoch: 0, controller: null as AbortController | null });
  const dirty = document !== acceptedDocument;
  const locked = disabled || busy || uncertain || readBusy;
  useLayoutEffect(() => onState({ dirty, busy: busy || readBusy, uncertain, error: !!error }), [
    dirty,
    busy,
    readBusy,
    uncertain,
    error,
    onState,
  ]);
  useLayoutEffect(() => () => onState({ dirty: false, busy: false }), [onState]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      reads.current.controller?.abort();
      reads.current.epoch++;
    };
  }, []);
  useEffect(() => {
    if ((!dirty && !review) || expectedVersion === undefined) {
      setExpectedVersion(definition?.schema_version);
      setComparisonDefinition(definition);
    }
  }, [definition?.schema_version, dirty, review, expectedVersion]);
  useEffect(() => {
    if (!document && !review && !result) setMode(typeId ? "update" : "copy");
  }, [typeId]);
  const sourceFields = useMemo<Array<[string, string]>>(() => {
    // Display assistance only. The untouched text always goes to the server's duplicate-aware parser.
    try {
      const value = JSON.parse(document);
      return value?.properties && typeof value.properties === "object" && !Array.isArray(value.properties)
        ? Object.entries(value.properties).filter(([key]) => /^prop_[1-9][0-9]*$/.test(key))
          .map((
            [key, field],
          ) => [
            key,
            field && typeof field === "object" && "title" in field && typeof field.title === "string"
              ? field.title
              : key,
          ])
        : [];
    } catch {
      return [];
    }
  }, [document]);
  const invalidate = () => {
    reads.current.controller?.abort();
    reads.current = { epoch: reads.current.epoch + 1, controller: null };
    setReview(null);
    setResult(null);
    setRemoveAcknowledged(false);
    setStale(false);
    setError("");
    setFields([]);
    setMessage("");
  };
  const editDocument = (value: string) => {
    invalidate();
    setDocument(value);
    setNewKeys([]);
    attempt.reset();
  };
  const failure = (value: unknown) => {
    setError(writeErrorMessage(value));
    setFields(value instanceof ApiError ? value.fields : []);
    if (value instanceof ApiError && ["conflict", "schema_changed", "schema_plan_stale"].includes(value.code)) {
      setStale(true);
    }
  };
  const input = (version = expectedVersion): EntitySchemaImportInput => ({
    mode,
    document,
    new_keys: mode === "update" ? newKeys : [],
    remove_keys: [],
    ...(mode === "update" ? { type_id: type!.id, expected_schema_version: version } : {}),
  });
  const preview = async (latest = false) => {
    if (locked || !document.trim() || mode === "update" && !type) return;
    if (new TextEncoder().encode(document).byteLength > entitySchemaImportLimits.raw_bytes) {
      setError("원문은 2MiB까지 읽을 수 있습니다. 파일이나 붙여넣은 내용을 확인하세요.");
      return;
    }
    reads.current.controller?.abort();
    const controller = new AbortController(), epoch = ++reads.current.epoch;
    reads.current.controller = controller;
    setReadBusy(true);
    setError("");
    setFields([]);
    setMessage("");
    setResult(null);
    const current = () => alive.current && !controller.signal.aborted && epoch === reads.current.epoch;
    try {
      let version = expectedVersion;
      if (latest && mode === "update") {
        const value = await api<EntitySchemaVersion>(
          "GET",
          `/entity-types/${type!.id}/schema`,
          undefined,
          controller.signal,
        );
        version = value.schema_version;
        if (current()) {
          setExpectedVersion(version);
          setComparisonDefinition(value);
        }
      }
      const value = await api<EntitySchemaImportReview>(
        "POST",
        "/entity-schema-import/preview",
        input(version),
        controller.signal,
      );
      if (current()) {
        setReview(value);
        setRemoveAcknowledged(false);
        setStale(false);
      }
    } catch (value) {
      if (current()) failure(value);
    } finally {
      if (current()) {
        reads.current.controller = null;
        setReadBusy(false);
      }
    }
  };
  const readFile = async (file: File | undefined) => {
    if (!file || locked) return;
    if (file.size > entitySchemaImportLimits.raw_bytes) {
      setError("파일은 2MiB까지 읽을 수 있습니다. 기존 입력은 유지했습니다.");
      return;
    }
    invalidate();
    const epoch = reads.current.epoch;
    setReadBusy(true);
    try {
      const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(await file.arrayBuffer());
      if (alive.current && epoch === reads.current.epoch) {
        setDocument(text);
        setFileName(file.name);
        setNewKeys([]);
        attempt.reset();
      }
    } catch {
      if (alive.current && epoch === reads.current.epoch) {
        setError("UTF-8 JSON 파일을 읽지 못했습니다. 기존 입력은 유지했습니다.");
      }
    } finally {
      if (alive.current && epoch === reads.current.epoch) setReadBusy(false);
    }
  };
  const prepare = async () => {
    if (
      busy || disabled || readBusy || blockedByDraft || !review || stale ||
      !uncertain && review.removed_keys.length > 0 && !removeAcknowledged
    ) return;
    const payload = { ...input(), preview_fingerprint: review.preview_fingerprint, remove_keys: review.removed_keys };
    setError("");
    setFields([]);
    setMessage("");
    try {
      await attempt.run(async () => {
        const value = await api<EntitySchemaImportResult>(
          "POST",
          "/entity-schema-import/prepare",
          payload,
          undefined,
          attempt.requestKey(),
        );
        if (!alive.current) return;
        setResult(value);
        setAcceptedDocument(document);
        setMessage(
          !value.changed
            ? "현재 정의와 같습니다. 새 버전이나 변경안을 만들지 않았습니다."
            : value.type
            ? "새 자료 종류를 만들었습니다. 아래에서 발급된 번호와 속성 대응을 확인하세요."
            : "가져온 정의로 변경안을 만들었습니다. 변경 이력에서 영향 분석과 적용을 이어가세요.",
        );
        onPrepared(value);
      });
    } catch (value) {
      if (alive.current) failure(value);
    }
  };
  const shown = review ? { ...review, ...result, schema: result?.schema ?? review.schema, diff: review.diff } : null;
  const currentDefinition = comparisonDefinition ?? (shown ? { schema: shown.schema } : null);
  return (
    <MaterialSettingsSection
      title="정의 가져오기"
      state={{ dirty, busy: busy || readBusy, uncertain, error: !!error }}
      summary="JSON 파일 · 붙여넣기"
    >
      <div className="settings-fields schema-import">
        <p className="help">종류와 속성 정의만 가져옵니다. 검토만으로 현재 자료나 값을 바꾸지 않습니다.</p>
        {error && (
          <div role="alert" className="error-text">
            <p>{error}</p>
            {fields.length > 0 && (
              <ul>
                {fields.map((field, index) => (
                  <li key={index}>
                    <code>{field.path}</code>: {field.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {message && <p role="status">{message}</p>}
        <fieldset className="settings-fields" disabled={locked}>
          <Field label="가져오는 방법">
            {(props) => (
              <select
                {...props}
                className="input"
                value={mode}
                onChange={(event) => {
                  invalidate();
                  setMode(event.target.value as "update" | "copy");
                  setNewKeys([]);
                }}
              >
                {typeId && <option value="update">선택한 종류 갱신 · {type?.label ?? "자료 종류 읽는 중…"}</option>}
                <option value="copy">새 종류로 복사</option>
              </select>
            )}
          </Field>
          {mode === "copy" && (
            <p className="help">
              원본과 별개의 자료 종류를 만듭니다. 종류 번호와 속성 번호는 서버가 새로 발급하며 기존 자료는 복사하지
              않습니다. 이름·아이콘·보관 상태가 없는 문서는 해당 값을 문서에 먼저 채워 주세요.
            </p>
          )}
          <Field label="JSON 파일">
            {(props) => (
              <div className="schema-import-file">
                <input
                  {...props}
                  ref={fileInput}
                  className="visually-hidden"
                  tabIndex={-1}
                  type="file"
                  accept=".json,application/json,application/schema+json"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    void readFile(file);
                  }}
                />
                <button
                  type="button"
                  className="btn"
                  onClick={() => fileInput.current?.click()}
                >
                  JSON 파일 선택
                </button>
                <span className="help">{fileName || "선택한 파일 없음"}</span>
              </div>
            )}
          </Field>
          <Field label="JSON 문서">
            {(props) => (
              <textarea
                {...props}
                className="input schema-import-document"
                rows={10}
                spellCheck={false}
                value={document}
                onChange={(event) => editDocument(event.target.value)}
              />
            )}
          </Field>
          <p className="help">
            UTF-8 JSON 원문은 2MiB, 저장되는 정의는 256KiB까지 지원합니다. 파일과 붙여넣기는 같은 서버 검사를
            사용합니다.
          </p>
          {mode === "update" && sourceFields.length > 0 && (
            <details>
              <summary>삭제·예약된 속성 번호를 새 항목으로 가져오기</summary>
              <p className="help">
                이전에 삭제되었거나 예약된 번호는 다시 쓰지 않습니다. 새 속성으로 가져올 항목만 선택하면 서버가 새
                번호에 대응합니다.
              </p>
              {sourceFields.map(([key, title]) => (
                <label className="choice-control" key={key}>
                  <input
                    type="checkbox"
                    checked={newKeys.includes(key)}
                    onChange={(event) => {
                      invalidate();
                      setNewKeys((keys) =>
                        event.target.checked ? [...keys, key] : keys.filter((value) => value !== key)
                      );
                    }}
                  />
                  {title} <span className="secondary">{key}</span>
                </label>
              ))}
            </details>
          )}
        </fieldset>
        <div className="actions schema-actions">
          <button
            type="button"
            className="btn"
            disabled={locked || !document}
            onClick={() => {
              editDocument("");
              setFileName("");
              setAcceptedDocument("");
              setExpectedVersion(definition?.schema_version);
            }}
          >
            입력 비우기
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={locked || !document.trim() ||
              mode === "update" && (!type || !definition || expectedVersion === undefined)}
            onClick={() => void preview()}
          >
            {readBusy ? "읽는 중…" : "가져올 내용 검토"}
          </button>
        </div>
        {stale && mode === "update" && (
          <div>
            <p className="help">
              검토 기준이 바뀌었습니다. 입력한 원문은 유지했습니다. 최신 정의와 다시 비교한 뒤 변경안을 만드세요.
            </p>
            <BodyAction disabled={locked} onClick={() => void preview(true)}>최신 정의 기준으로 다시 검토</BodyAction>
          </div>
        )}
        {shown && currentDefinition && (
          <section className="schema-import-review" aria-label="가져올 정의 검토">
            <h3 className="section-title">{mode === "copy" ? "새 종류로 복사할 내용" : "현재 정의와 비교"}</h3>
            <dl className="props">
              <div>
                <dt>파일 원본 버전</dt>
                <dd>{shown.source_schema_version}</dd>
              </div>
              <div>
                <dt>현재 게시 버전</dt>
                <dd>{shown.current_schema_version ?? "새 종류 · 첫 버전"}</dd>
              </div>
            </dl>
            {shown.source_is_stale && (
              <p className="help">
                원본 버전과 현재 게시 버전이 다릅니다. 아래 차이는 현재 정의와 비교한 결과이며 원본 버전은 그대로
                유지했습니다.
              </p>
            )}
            {shown.metadata_preserved && (
              <p className="help">
                서버가 확인한 과거 문서입니다. 당시 기록이 없는 종류 이름·아이콘·보관 상태는 현재 값을 유지합니다.
              </p>
            )}
            {Object.entries(shown.key_mapping).length > 0 && (
              <div>
                <h4 className="section-title">속성 번호 대응</h4>
                <ul>
                  {Object.entries(shown.key_mapping).map(([from, to]) => (
                    <li key={from}>
                      {sourceFields.find(([key]) => key === from)?.[1] ?? from}: <code>{from}</code> → <code>{to}</code>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {result?.type && (
              <p>
                새 종류 번호: <code>{result.type.id}</code> ·{" "}
                <Link to={`/settings/entity-types/${result.type.id}`}>새 종류 설정 열기</Link>
              </p>
            )}
            {shown.diff.length > 0
              ? (
                <dl className="schema-change-list">
                  {shown.diff.map((diff, index) => (
                    <div key={index}>
                      <dt>{schemaDiffLabel(diff.path, { schema: shown.schema }, currentDefinition)}</dt>
                      <dd>
                        {diff.before_present
                          ? schemaDiffValueLabel(diff.path, diff.before, currentDefinition)
                          : "설정 안 함"} → {diff.after_present
                          ? schemaDiffValueLabel(diff.path, diff.after, { schema: shown.schema })
                          : "설정 안 함"}
                        {diff.kind === "migration_required" && " · 값 변환 필요"}
                      </dd>
                    </div>
                  ))}
                </dl>
              )
              : (
                <p>
                  {shown.changed
                    ? "새 종류의 정의를 확인했습니다."
                    : "현재 정의와 같습니다. 새 버전이나 변환 작업을 만들지 않습니다."}
                </p>
              )}
            {shown.removed_keys.length > 0 && (
              <div>
                <h4 className="section-title">문서에서 빠진 속성</h4>
                <ul>
                  {shown.removed_keys.map((key) => (
                    <li key={key}>{definition?.schema.properties[key]?.title ?? key}</li>
                  ))}
                </ul>
                <label className="choice-control">
                  <input
                    type="checkbox"
                    checked={removeAcknowledged}
                    disabled={locked || !!result}
                    onChange={(event) => setRemoveAcknowledged(event.target.checked)}
                  />빠진 속성을 영구 제거하는 변경안에 포함합니다.
                </label>
                <p className="help">
                  이 단계에서는 값을 삭제하지 않습니다. 기존 영향 분석·값 변환과 원본 보존을 거쳐 적용합니다.
                </p>
              </div>
            )}
            {blockedByDraft && (
              <p className="help">입력 항목에서 편집 중인 내용을 먼저 검토하거나 취소한 뒤 가져온 변경안을 만드세요.</p>
            )}
            {!result && (
              <div className="actions schema-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={disabled || busy || readBusy || blockedByDraft || stale ||
                    !uncertain && shown.removed_keys.length > 0 && !removeAcknowledged}
                  onClick={() => void prepare()}
                >
                  {busy
                    ? "처리 중…"
                    : uncertain
                    ? "같은 요청 다시 확인"
                    : mode === "copy"
                    ? "검토한 정의로 새 종류 만들기"
                    : shown.changed
                    ? "검토한 정의로 변경안 만들기"
                    : "변경 없음 확인"}
                </button>
              </div>
            )}
          </section>
        )}
      </div>
    </MaterialSettingsSection>
  );
}

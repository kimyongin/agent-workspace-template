import { TypeIdentitySettings } from "./TypeIdentitySettings.tsx";
import type { MaterialSectionState } from "./MaterialSettingsSection.tsx";
import { BodyAction } from "../../components/BodyAction.tsx";
import { createMaterialDefinition } from "./material-definition.ts";
import { SettingsHeading } from "./SettingsHeading.tsx";
import { MaterialSettingsProtection } from "./MaterialSettingsProtection.tsx";
import { MaterialSettingsSection } from "./MaterialSettingsSection.tsx";
import { useAuth } from "../auth/AuthProvider.tsx";
import { invalidateEntityTypeCatalog } from "../entity/entity-type-catalog.ts";
import { useEntityTypes } from "../entity/useEntityTypes.ts";
import { SchemaEditor } from "./SchemaEditor.tsx";
import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import { api, ApiError } from "../../lib/api.ts";
import { Field } from "../../components/Field.tsx";
import { type EntitySchemaVersion, type EntityType, entityTypeIcons } from "@contracts/entity-type.ts";
import { useWriteAttempt, writeErrorMessage } from "../../lib/write-attempt.ts";
import "./settings.css";
import { EntityTypeIcon } from "../entity/EntityTypeIcon.tsx";
export function EntityTypeSettings() {
  const { type_id } = useParams();
  return <EntityTypeSettingsEditor key={type_id ?? "create"} type_id={type_id} />;
}
function EntityTypeSettingsEditor({ type_id }: { type_id?: string }) {
  const { session } = useAuth();
  const iconGroup = useId();
  const { type_id: activeTypeId, job_id } = useParams();
  const queryJob = new URLSearchParams(useLocation().search).get("job_id");
  const selectedJob = job_id ?? queryJob ?? undefined;
  const location = useLocation();
  const navigate = useNavigate();
  const versions = location.pathname.endsWith("/versions");
  const historyVersion = new URLSearchParams(location.search).get(
    "schema_version",
  );
  const catalog = useEntityTypes();
  const items = catalog.types ?? [];
  const [definitions] = useState(() => createMaterialDefinition(type_id));
  const {
    type,
    schema,
    history,
    historyBefore,
    historyBusy,
    label,
    icon,
    archived,
    basicConflict,
    latestBasics,
    latestBusy,
    dirty: basicDirty,
    jobErrors,
  } = useSyncExternalStore(definitions.subscribe, definitions.snapshot);
  useEffect(() => {
    definitions.selectJob(selectedJob);
  }, [definitions, selectedJob]);
  const [representative, setRepresentative] = useState("이름");
  const [jobState, setJobState] = useState({ dirty: false, busy: false, uncertain: false, error: false });
  const jobStateChange = useCallback(
    (state: { dirty: boolean; busy: boolean; uncertain?: boolean; error?: boolean }) =>
      setJobState({ ...state, uncertain: !!state.uncertain, error: !!state.error }),
    [],
  );
  const [identityState, setIdentityState] = useState<MaterialSectionState>({ dirty: false, busy: false });
  const identityStateChange = useCallback((state: MaterialSectionState) => setIdentityState(state), []);
  const [schemaState, setSchemaState] = useState({ dirty: false, busy: false, uncertain: false });
  const schemaStateChange = useCallback(
    (state: { dirty: boolean; busy: boolean; uncertain: boolean }) => setSchemaState(state),
    [],
  );
  const [selectedSchema, setSelectedSchema] = useState<
    EntitySchemaVersion | null
  >(null);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const selector = useRef<HTMLSelectElement>(null);
  const creationName = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!loading && location.state?.materialTypeFocus) {
      (type_id ? selector.current : creationName.current)?.focus();
    }
  }, [loading, location.state?.materialTypeFocus, type_id]);
  const { attempt, busy, uncertain } = useWriteAttempt();
  const createdTypeId = useRef<string | null>(null);
  const readLatestBasics = async () => {
    if (!type_id || busy || uncertain || latestBusy) return;
    setError("");
    try {
      await definitions.readLatestBasics();
      if (!mounted.current) return;
      attempt.reset();
      if (session) invalidateEntityTypeCatalog(session.user.id);
    } catch (error) {
      if (mounted.current) setError(error instanceof Error ? error.message : "최신 기본 정보를 읽지 못했습니다.");
    }
  };
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const dirty = type_id ? basicDirty : label !== "" || icon !== "box" || representative !== "이름";
  const protectedDraft = dirty || busy || uncertain || identityState.dirty || identityState.uncertain ||
    identityState.busy ||
    schemaState.dirty || schemaState.busy || schemaState.uncertain || jobState.dirty || jobState.busy ||
    jobState.uncertain;
  const anyBusy = busy || identityState.busy || schemaState.busy ||
    jobState.busy;
  useEffect(() => {
    const controller = new AbortController();
    setSelectedSchema(null);
    setLoading(true);
    setError("");
    void definitions.initialize(controller.signal).catch((e) => {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "조회하지 못했습니다");
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => {
      controller.abort();
      definitions.dispose();
    };
  }, [definitions]);
  useEffect(() => {
    if (!type_id || !historyVersion) {
      setSelectedSchema(null);
      return;
    }
    const controller = new AbortController();
    void api<EntitySchemaVersion>(
      "GET",
      `/entity-types/${type_id}/schema?schema_version=${encodeURIComponent(historyVersion)}`,
      undefined,
      controller.signal,
    )
      .then((value) => {
        if (!controller.signal.aborted) setSelectedSchema(value);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(error.message);
      });
    return () => controller.abort();
  }, [type_id, historyVersion]);
  const readHistoryPage = async () => {
    setError("");
    try {
      await definitions.readHistoryPage();
    } catch (e) {
      if (mounted.current && !(e instanceof DOMException && e.name === "AbortError")) {
        setError(e instanceof Error ? e.message : "이전 게시 버전을 읽지 못했습니다.");
      }
    }
  };
  const retryRead = async () => {
    if (loading || busy) return;
    setLoading(true);
    setError("");
    try {
      await definitions.refresh(undefined, false);
    } catch (e) {
      if (mounted.current) {
        setError(e instanceof Error ? e.message : "조회하지 못했습니다");
      }
    } finally {
      if (mounted.current) setLoading(false);
    }
  };
  const save = async () => {
    if (busy || schemaState.busy || latestBusy || basicConflict || (!dirty && !uncertain)) return;
    setError("");
    setMessage("");
    const current = {
      method: type_id ? "PATCH" : "POST",
      path: type_id ? `/entity-types/${type_id}` : "/entity-types",
      input: type_id ? definitions.basicSaveInput() : { label, icon_id: icon, representative_label: representative },
    };
    try {
      await attempt.run(async () => {
        const saved = await api<EntityType>(
          current.method,
          current.path,
          current.input,
          undefined,
          attempt.requestKey(),
        );
        if (!mounted.current) return;
        if (session) invalidateEntityTypeCatalog(session.user.id);
        if (type_id) {
          definitions.acceptBasicSave(saved);
        } else {
          definitions.cancelBasics();
          setRepresentative("이름");
          createdTypeId.current = saved.id;
        }
        setMessage("자료 종류를 저장했습니다.");
      });
      if (type_id) {
        try {
          await definitions.refresh();
        } catch {
          if (mounted.current) {
            setError("자료 종류를 저장했습니다. 최신 정의를 불러오지 못했습니다. 정의를 다시 조회하세요.");
          }
        }
      }
      // A retry replays the first callback, so its confirmed result must outlive a save invocation.
      if (createdTypeId.current) {
        requestAnimationFrame(() => {
          if (mounted.current && createdTypeId.current) {
            navigate(`/settings/entity-types/${createdTypeId.current}`, { state: { materialTypeFocus: true } });
          }
        });
      }
    } catch (e) {
      if (mounted.current) {
        const conflict = e instanceof ApiError && (e.code === "conflict" || e.code === "schema_changed");
        definitions.conflict(conflict);
        setError(
          conflict ? `${e.message} 최신 기본 정보를 확인하고 입력을 비교한 뒤 다시 저장하세요.` : writeErrorMessage(e),
        );
      }
    }
  };
  const cancel = () => {
    if (busy || uncertain || latestBusy || basicConflict) return;
    attempt.reset();
    setError("");
    setMessage("");
    definitions.cancelBasics();
    setRepresentative("이름");
  };

  // The router may expose destination params while the previous editor is still mounted.
  // Its draft belongs to its fixed route scope and must never become the destination form.
  if (activeTypeId !== type_id) {
    return (
      <section className="panel settings">
        <p role="status">불러오는 중…</p>
      </section>
    );
  }
  return (
    <section
      className="panel settings"
      aria-labelledby="entity-types-title"
    >
      <SettingsHeading
        title="자료 설정"
        description="자료 종류별 입력 항목과 식별자, 변경 이력을 관리합니다."
        id="entity-types-title"
      />

      {(type_id || items.length > 0) && (
        <div className="material-settings-toolbar">
          <Field label="자료 종류 선택" hideLabel>
            {(props) => (
              <select
                {...props}
                className="input"
                ref={selector}
                value={type_id ?? ""}
                disabled={anyBusy}
                onChange={(event) =>
                  navigate(
                    event.target.value ? `/settings/entity-types/${event.target.value}` : "/settings/entity-types",
                    { state: { materialTypeFocus: true } },
                  )}
              >
                {!type_id && <option value="" disabled>기존 종류 선택</option>}
                {type_id && !items.some((item) => item.id === type_id) && (
                  <option value={type_id}>
                    {type?.label ?? "자료 종류 읽는 중…"}
                  </option>
                )}
                {items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                    {item.archived ? " (보관)" : ""}
                  </option>
                ))}
              </select>
            )}
          </Field>
          {type_id && (
            <Link
              className="btn btn-input"
              to="/settings/entity-types"
              state={{ materialTypeFocus: true }}
            >
              종류 추가
            </Link>
          )}
        </div>
      )}
      {loading && <p role="status">불러오는 중…</p>}
      {!catalog.types && !catalog.error && <p role="status">자료 종류를 읽는 중…</p>}
      {catalog.error && (
        <p role="alert" className="error-text">
          자료 종류를 읽지 못했습니다.{" "}
          <BodyAction icon="reset" onClick={catalog.retry}>
            자료 종류 다시 조회
          </BodyAction>
        </p>
      )}
      {error && <p role="alert" className="error-text">{error}</p>}
      {error && !loading && (!type_id || !type) && (
        <BodyAction icon="reset" onClick={() => void retryRead()}>
          조회 다시 시도
        </BodyAction>
      )}
      {message && <p role="status">{message}</p>}
      {!loading && (!type_id || type) && (
        <MaterialSettingsSection
          title={type_id ? "기본 정보" : "자료 종류 만들기"}
          summary={type?.archived ? "보관" : undefined}
          state={{ dirty, busy, uncertain, error: !!error }}
          initialOpen={!type_id}
        >
          <form
            className="form"
            aria-label={type_id ? "기본 정보" : "자료 종류 만들기"}
            aria-busy={busy || latestBusy}
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            {latestBasics && (
              <p className="secondary" role="status">
                최신 저장값: {latestBasics.label} ·{" "}
                {entityTypeIcons.find((value) => value.id === latestBasics.icon_id)?.label} ·{" "}
                {latestBasics.archived ? "보관" : "사용 중"} · 버전{" "}
                {latestBasics.schema_version}. 변경한 입력은 유지했습니다. 비교한 뒤 기본 정보를 저장하거나 변경 취소로
                최신 저장값을 사용하세요.
              </p>
            )}
            <fieldset className="settings-fields" disabled={busy || uncertain || latestBusy}>
              <Field label="자료 종류 이름">
                {(props) => (
                  <input
                    {...props}
                    ref={type_id ? undefined : creationName}
                    className="input"
                    required
                    maxLength={80}
                    value={label}
                    onChange={(e) => definitions.editBasic("label", e.target.value)}
                  />
                )}
              </Field>
              <fieldset className="entity-type-icon-picker">
                <legend className="label">아이콘</legend>
                <div className="entity-type-icon-options">
                  {entityTypeIcons.map((item) => (
                    <label className="entity-type-icon-option" key={item.id}>
                      <input
                        type="radio"
                        name={iconGroup}
                        value={item.id}
                        checked={icon === item.id}
                        onChange={() => definitions.editBasic("icon", item.id)}
                      />
                      <span className="entity-type-icon-face">
                        <EntityTypeIcon id={item.id} />
                        <span>{item.label}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
              {!type_id && (
                <Field label="대표 속성 이름">
                  {(props) => (
                    <input
                      {...props}
                      className="input"
                      required
                      maxLength={80}
                      value={representative}
                      onChange={(e) => setRepresentative(e.target.value)}
                    />
                  )}
                </Field>
              )}
              {type_id && (
                <label className="choice-control">
                  <input
                    type="checkbox"
                    checked={archived}
                    onChange={(e) => definitions.editBasic("archived", e.target.checked)}
                  />{" "}
                  자료 종류 보관 (기존 자료와 연결은 유지)
                </label>
              )}
            </fieldset>
            <div className="settings-section-footer">
              {uncertain && (
                <p className="secondary" role="status">
                  저장 여부를 알 수 없습니다. 같은 요청으로 다시 확인하세요. 새로고침 후에는 현재 상태를 조회한 뒤 새
                  작업을 시작하세요.
                </p>
              )}
              <div className="actions">
                <button
                  type="button"
                  className="btn"
                  disabled={busy || uncertain || latestBusy || basicConflict || !dirty}
                  onClick={cancel}
                  aria-label="변경 취소"
                >
                  취소
                </button>
                {basicConflict && (
                  <button
                    type="button"
                    className="btn"
                    disabled={busy || uncertain || latestBusy}
                    onClick={() => void readLatestBasics()}
                  >
                    {latestBusy ? "최신 기본 정보 읽는 중…" : "최신 기본 정보 확인"}
                  </button>
                )}
                <button
                  className="btn btn-primary"
                  aria-label={busy
                    ? "저장 중…"
                    : uncertain
                    ? "같은 요청 다시 확인"
                    : type_id
                    ? "기본 정보 저장"
                    : "자료 종류 만들기"}
                  disabled={anyBusy || latestBusy || basicConflict || (!dirty && !uncertain)}
                >
                  {busy ? "저장 중…" : uncertain ? "같은 요청 다시 확인" : type_id ? "저장" : "자료 종류 만들기"}
                </button>
              </div>
            </div>
          </form>
        </MaterialSettingsSection>
      )}
      {!loading && type_id && type && (
        <TypeIdentitySettings
          typeId={type_id}
          onState={identityStateChange}
          disabled={busy || uncertain || schemaState.busy || schemaState.uncertain || jobState.busy ||
            jobState.uncertain}
        />
      )}
      {schema && type && (
        <SchemaEditor
          type={type}
          definition={schema}
          historyInitiallyOpen={versions || !!historyVersion || location.pathname.includes("/migrations") ||
            !!selectedJob}
          historyVersions={history}
          selectedVersion={selectedSchema}
          historyBefore={historyBefore}
          historyBusy={historyBusy}
          onMoreVersions={readHistoryPage}
          selectedJob={selectedJob}
          historyJobState={jobState}
          onMigrationApplied={definitions.migrationSucceeded}
          jobErrors={jobErrors}
          onJobState={jobStateChange}
          jobDisabled={busy || uncertain || identityState.busy || identityState.uncertain || schemaState.busy ||
            schemaState.uncertain}
          onApplied={definitions.published}
          onState={schemaStateChange}
          disabled={busy || uncertain || identityState.busy || identityState.uncertain || jobState.busy ||
            jobState.uncertain}
        />
      )}
      <MaterialSettingsProtection
        dirty={protectedDraft}
        busy={anyBusy}
        typeId={type_id}
        jobId={selectedJob}
        protectJob={jobState.dirty || jobState.uncertain}
      />
    </section>
  );
}

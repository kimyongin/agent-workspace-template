import { MaterialCommonSettings } from "./MaterialCommonSettings.tsx";
import { RecordTemplateSettings } from "./RecordTemplateSettings.tsx";
import { createMaterialTemplateDrafts } from "./material-template-drafts.ts";
import { MaterialSettingsProtection } from "./MaterialSettingsProtection.tsx";
import { MigrationJobs, SchemaMigrationJob } from "./SchemaMigrationJobs.tsx";
import { MaterialSettingsSection } from "./MaterialSettingsSection.tsx";
import { useAuth } from "../auth/AuthProvider.tsx";
import { invalidateEntityTypeCatalog } from "../entity/entity-type-catalog.ts";
import { useEntityTypes } from "../entity/useEntityTypes.ts";
import { SchemaEditor, SchemaVersionDiff } from "./SchemaEditor.tsx";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import { api, ApiError } from "../../lib/api.ts";
import { Field } from "../../components/Field.tsx";
import {
  type EntitySchemaVersion,
  type EntitySchemaVersionSummary,
  type EntityType,
  entityTypeIcons,
} from "@contracts/entity-type.ts";
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
  const [templates] = useState(() => createMaterialTemplateDrafts(type_id));
  useEffect(() => {
    const refresh = () => {
      void templates.refreshTags();
    };
    window.addEventListener("workspace:tags-changed", refresh);
    return () => {
      window.removeEventListener("workspace:tags-changed", refresh);
      templates.dispose();
    };
  }, [templates]);
  const [recordState, setRecordState] = useState({ dirty: false, busy: false });
  const [commonState, setCommonState] = useState({ dirty: false, busy: false });
  const [commonOpen, setCommonOpen] = useState(() => new URLSearchParams(window.location.search).get("common") === "1");
  const commonButton = useRef<HTMLButtonElement>(null);
  const commonScroll = useRef({ page: 0, pane: 0 });
  const { type_id: activeTypeId, job_id } = useParams();
  const queryJob = new URLSearchParams(useLocation().search).get("job_id");
  const selectedJob = job_id ?? queryJob ?? undefined;
  const location = useLocation();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const versions = location.pathname.endsWith("/versions");
  const historyVersion = new URLSearchParams(location.search).get(
    "schema_version",
  );
  const catalog = useEntityTypes();
  const items = catalog.types ?? [];
  const [type, setType] = useState<EntityType | null>(null),
    [schema, setSchema] = useState<EntitySchemaVersion | null>(null),
    [history, setHistory] = useState<EntitySchemaVersionSummary[]>([]);
  const [historyBefore, setHistoryBefore] = useState<number | null>(null);
  const [historyBusy, setHistoryBusy] = useState(false);
  const historyPending = useRef<AbortController | null>(null);
  const [label, setLabel] = useState(""),
    [icon, setIcon] = useState("box"),
    [representative, setRepresentative] = useState("이름"),
    [archived, setArchived] = useState(false);
  const [jobState, setJobState] = useState({ dirty: false, busy: false, uncertain: false });
  const jobStateChange = useCallback(
    (state: { dirty: boolean; busy: boolean; uncertain?: boolean }) =>
      setJobState({ ...state, uncertain: !!state.uncertain }),
    [],
  );
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
  useEffect(() => {
    if (!loading && location.state?.materialTypeFocus) {
      selector.current?.focus();
    }
  }, [loading, location.state?.materialTypeFocus]);
  const { attempt, busy, uncertain } = useWriteAttempt();
  const createdTypeId = useRef<string | null>(null);
  const [basicConflict, setBasicConflict] = useState(false);
  const [latestBasics, setLatestBasics] = useState<EntityType | null>(null);
  const [latestBusy, setLatestBusy] = useState(false);
  const latestPending = useRef<AbortController | null>(null);
  const basicBaseline = useRef(type);
  basicBaseline.current = type;
  useEffect(() => () => latestPending.current?.abort(), []);
  const applySavedType = (saved: EntityType, preserveDraft: boolean) => {
    const previous = basicBaseline.current;
    setLabel((value) => preserveDraft && previous && value !== previous.label ? value : saved.label);
    setIcon((value) => preserveDraft && previous && value !== previous.icon_id ? value : saved.icon_id);
    setArchived((value) => preserveDraft && previous && value !== previous.archived ? value : saved.archived);
    setType(saved);
  };
  const readLatestBasics = async () => {
    if (!type_id || busy || uncertain || latestBusy) return;
    const controller = new AbortController();
    latestPending.current?.abort();
    latestPending.current = controller;
    setLatestBusy(true);
    setError("");
    try {
      const saved = await api<EntityType>("GET", `/entity-types/${type_id}`, undefined, controller.signal);
      if (controller.signal.aborted || !mounted.current) return;
      applySavedType(saved, true);
      setLatestBasics(saved);
      setBasicConflict(false);
      attempt.reset();
      if (session) invalidateEntityTypeCatalog(session.user.id);
    } catch (error) {
      if (!controller.signal.aborted && mounted.current) {
        setError(error instanceof Error ? error.message : "최신 기본 정보를 읽지 못했습니다.");
      }
    } finally {
      if (!controller.signal.aborted && mounted.current) setLatestBusy(false);
    }
  };
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const dirty = type_id
    ? !!type &&
      (label !== type.label || icon !== type.icon_id ||
        archived !== type.archived)
    : label !== "" || icon !== "box" || representative !== "이름";
  const protectedDraft = recordState.dirty || commonState.dirty ||
    recordState.busy || commonState.busy || dirty || busy || uncertain ||
    schemaState.dirty || schemaState.busy || schemaState.uncertain || jobState.dirty || jobState.busy ||
    jobState.uncertain;
  const anyBusy = busy || schemaState.busy || recordState.busy ||
    commonState.busy || jobState.busy;
  const load = async (signal?: AbortSignal, preserveBasics = false) => {
    if (type_id) {
      const [saved, definition, versions] = await Promise.all([
        api<EntityType>("GET", `/entity-types/${type_id}`, undefined, signal),
        api<EntitySchemaVersion>(
          "GET",
          `/entity-types/${type_id}/schema`,
          undefined,
          signal,
        ),
        api<
          { items: EntitySchemaVersionSummary[]; next_before: number | null }
        >(
          "GET",
          `/entity-types/${type_id}/schemas`,
          undefined,
          signal,
        ),
      ]);
      signal?.throwIfAborted();
      if (!mounted.current) return;
      applySavedType(saved, preserveBasics);
      setSchema(definition);
      setHistory(versions.items);
      setHistoryBefore(versions.next_before ?? null);
    }
  };
  const refreshDefinitions = useCallback(() => load(undefined, true), [type_id]);
  useEffect(() => {
    const controller = new AbortController();
    historyPending.current?.abort();
    historyPending.current = null;
    setHistoryBusy(false);
    setHistoryBefore(null);
    setHistory([]);
    setSelectedSchema(null);
    setLoading(true);
    setError("");
    setType(null);
    setLabel("");
    void load(controller.signal).catch((e) => {
      if (!controller.signal.aborted) {
        setError(e instanceof Error ? e.message : "조회하지 못했습니다");
      }
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [type_id]);
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
    if (historyBusy || historyBefore === null || !type_id) return;
    const controller = new AbortController();
    historyPending.current?.abort();
    historyPending.current = controller;
    setHistoryBusy(true);
    setError("");
    try {
      const page = await api<
        { items: EntitySchemaVersionSummary[]; next_before: number | null }
      >(
        "GET",
        `/entity-types/${type_id}/schemas?before=${historyBefore}`,
        undefined,
        controller.signal,
      );
      if (!controller.signal.aborted && mounted.current) {
        setHistory((
          items,
        ) => [
          ...items,
          ...page.items.filter((row) => !items.some((item) => item.schema_version === row.schema_version)),
        ]);
        setHistoryBefore(page.next_before);
      }
    } catch (e) {
      if (!controller.signal.aborted && mounted.current) {
        setError(
          e instanceof Error ? e.message : "이전 게시 버전을 읽지 못했습니다.",
        );
      }
    } finally {
      if (!controller.signal.aborted && mounted.current) setHistoryBusy(false);
    }
  };
  useEffect(() => () => historyPending.current?.abort(), []);
  const retryRead = async () => {
    if (loading || busy) return;
    setLoading(true);
    setError("");
    try {
      await load();
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
      input: type_id
        ? {
          expected_type_version: type!.version,
          expected_schema_version: type!.schema_version,
          label,
          icon_id: icon,
          archived,
        }
        : { label, icon_id: icon, representative_label: representative },
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
          applySavedType(saved, false);
          setLatestBasics(null);
          setBasicConflict(false);
        } else {
          setLabel("");
          setIcon("box");
          setRepresentative("이름");
          createdTypeId.current = saved.id;
        }
        setMessage("자료 종류를 저장했습니다.");
      });
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
        const conflict = e instanceof ApiError && e.code === "conflict";
        setBasicConflict(conflict);
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
    setLabel(type?.label ?? "");
    setIcon(type?.icon_id ?? "box");
    setRepresentative("이름");
    setArchived(type?.archived ?? false);
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
      className={`panel settings${commonOpen ? " material-common-open" : ""}`}
      aria-labelledby="entity-types-title"
    >
      <h1 id="entity-types-title" className="page-title">자료 설정</h1>
      <div className="material-settings-toolbar">
        <Field label="자료 종류 검색">
          {(props) => (
            <input
              {...props}
              className="input"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="이름으로 찾기"
            />
          )}
        </Field>
        <Field label="자료 종류 선택">
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
              <option value="">종류 추가</option>
              {type_id && !items.some((item) => item.id === type_id) && (
                <option value={type_id}>
                  {type?.label ?? "자료 종류 읽는 중…"}
                </option>
              )}
              {items.filter((item) =>
                item.id === type_id ||
                item.label.toLocaleLowerCase().includes(
                  search.toLocaleLowerCase(),
                )
              ).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                  {item.archived ? " (보관)" : ""}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Link className="btn" to="/settings/entity-types">종류 추가</Link>
        <button
          ref={commonButton}
          aria-label="공통 설정"
          className="btn"
          aria-expanded={commonOpen}
          onClick={() => {
            if (!commonOpen) {
              commonScroll.current = {
                page: window.scrollY,
                pane: commonButton.current?.closest(".workspace-list")?.scrollTop ??
                  0,
              };
              setCommonOpen(true);
            }
          }}
        >
          공통 설정{commonState.busy ? " · 저장 중…" : commonState.dirty ? " · 미저장" : ""}
        </button>
      </div>
      <MaterialCommonSettings
        open={commonOpen}
        templates={templates.common}
        onStateChange={setCommonState}
        onClose={() => {
          setCommonOpen(false);
          requestAnimationFrame(() => {
            commonButton.current?.focus({ preventScroll: true });
            window.scrollTo({
              top: commonScroll.current.page,
              behavior: "instant",
            });
            const pane = commonButton.current?.closest(".workspace-list");
            if (pane) pane.scrollTop = commonScroll.current.pane;
          });
        }}
      />
      {type && (
        <p className="material-settings-current">
          <EntityTypeIcon id={type.icon_id} /> {type.label}
          {type.archived ? " · 보관됨" : ""}
        </p>
      )}
      {loading && <p role="status">불러오는 중…</p>}
      {!catalog.types && !catalog.error && <p role="status">자료 종류를 읽는 중…</p>}
      {catalog.error && (
        <p role="alert">
          자료 종류를 읽지 못했습니다.{" "}
          <button className="btn" onClick={catalog.retry}>
            자료 종류 다시 조회
          </button>
        </p>
      )}
      {error && <p role="alert" className="error-text">{error}</p>}
      {error && !loading && (!type_id || !type) && (
        <button
          className="btn"
          onClick={() => void retryRead()}
        >
          조회 다시 시도
        </button>
      )}
      {message && <p role="status">{message}</p>}
      {!loading && !type_id && (
        <>
          {catalog.types && items.length === 0 && !catalog.error && !error && (
            <p className="secondary">
              자료 종류가 없습니다. 이름을 정해 첫 자료 종류를 만드세요.
            </p>
          )}
        </>
      )}
      {!loading && (!type_id || type) && (
        <MaterialSettingsSection
          title={type_id ? "기본 정보" : "자료 종류 만들기"}
          summary={type ? `${type.label} · ${type.archived ? "보관" : "사용 중"}` : undefined}
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
                {latestBasics.version}. 변경한 입력은 유지했습니다. 비교한 뒤 기본 정보를 저장하거나 변경 취소로 최신
                저장값을 사용하세요.
              </p>
            )}
            <fieldset className="settings-fields" disabled={busy || uncertain || latestBusy}>
              <Field label="자료 종류 이름">
                {(props) => (
                  <input
                    {...props}
                    className="input"
                    required
                    maxLength={80}
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
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
                        onChange={() => setIcon(item.id)}
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
                <label>
                  <input
                    type="checkbox"
                    checked={archived}
                    onChange={(e) => setArchived(e.target.checked)}
                  />{" "}
                  자료 종류 보관 (기존 자료와 연결은 유지)
                </label>
              )}
            </fieldset>
            <div className="settings-section-footer">
              <p className="secondary">
                {uncertain
                  ? "저장 여부를 알 수 없습니다. 같은 요청으로 다시 확인하세요. 새로고침 후에는 현재 상태를 조회한 뒤 새 작업을 시작하세요."
                  : type_id
                  ? "이름·아이콘·보관 상태 변경은 속성 정의와 저장값을 바꾸지 않습니다."
                  : "필수 텍스트 대표 속성과 함께 생성합니다."}
              </p>
              <button
                type="button"
                className="btn"
                disabled={busy || uncertain || latestBusy || basicConflict || !dirty}
                onClick={cancel}
              >
                변경 취소
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
                disabled={anyBusy || latestBusy || basicConflict || (!dirty && !uncertain)}
              >
                {busy
                  ? "저장 중…"
                  : uncertain
                  ? "같은 요청 다시 확인"
                  : type_id
                  ? "기본 정보 저장"
                  : "자료 종류 만들기"}
              </button>
            </div>
          </form>
        </MaterialSettingsSection>
      )}
      {schema && type && (
        <SchemaEditor
          type={type}
          definition={schema}
          onApplied={refreshDefinitions}
          onState={schemaStateChange}
          disabled={busy || uncertain || jobState.busy || jobState.uncertain}
        />
      )}
      {type_id && selectedJob && (
        <SchemaMigrationJob
          key={selectedJob}
          typeId={type_id}
          jobId={selectedJob}
          onState={jobStateChange}
          disabled={busy || uncertain || schemaState.busy || schemaState.uncertain}
        />
      )}
      {type_id && (
        <MaterialSettingsSection
          title="현재 종류 기록 기본값"
          state={recordState}
        >
          <RecordTemplateSettings
            materialResource={templates.typed}
            materialTypeId={type_id}
            publishedVersion={schema?.schema_version}
            onStateChange={setRecordState}
          />
        </MaterialSettingsSection>
      )}
      {type_id && (
        <MaterialSettingsSection
          title="변경 이력"
          summary={`현재 버전 ${schema?.schema_version ?? "…"}`}
          initialOpen={versions || !!historyVersion || location.pathname.includes("/migrations") || !!selectedJob}
        >
          {selectedSchema && schema && <SchemaVersionDiff before={selectedSchema} after={schema} />}
          <MigrationJobs typeId={type_id} />
          {history.map((value) => (
            <details key={value.schema_version}>
              <summary>
                버전 {value.schema_version} · {new Date(value.created_at).toLocaleString()}
              </summary>
              <button
                className="btn"
                onClick={() => {
                  const params = new URLSearchParams(location.search);
                  params.set("schema_version", String(value.schema_version));
                  navigate(`${location.pathname}?${params}`);
                }}
              >
                이 버전 보기
              </button>
            </details>
          ))}
          {historyBefore !== null && (
            <button
              className="btn"
              disabled={historyBusy}
              onClick={() => void readHistoryPage()}
            >
              {historyBusy ? "이전 버전 읽는 중…" : "이전 게시 버전 더 보기"}
            </button>
          )}
        </MaterialSettingsSection>
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

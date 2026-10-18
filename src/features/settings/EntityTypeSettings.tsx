import { useApi, useRequestScope } from "../../lib/api-context.tsx";
import { RotateCcwIcon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { FieldSet, FieldLegend, FieldLabel } from "@/components/ui/field";
import { Checkbox } from "@/components/ui/checkbox";
import { NativeSelect, NativeSelectOption } from "../../components/ui/native-select.tsx";
import { Input } from "../../components/ui/input.tsx";
import { Button } from "../../components/ui/button.tsx";
import { TypeIdentitySettings } from "./TypeIdentitySettings.tsx";
import type { MaterialSectionState } from "./MaterialSettingsSection.tsx";

import { createMaterialDefinition } from "./material-definition.ts";
import { MaterialSettingsHeading } from "./MaterialSettingsHeading.tsx";
import { MaterialSettingsProtection } from "./MaterialSettingsProtection.tsx";
import { MaterialSettingsSection } from "./MaterialSettingsSection.tsx";
import { useAuth } from "../auth/AuthProvider.tsx";
import { invalidateEntityTypeCatalog } from "../entity/entity-type-catalog.ts";
import { useEntityTypes } from "../entity/useEntityTypes.ts";
import { SchemaEditor } from "./SchemaEditor.tsx";
import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { Link, useLocation, useNavigate, useParams } from "../../lib/workspace-router.tsx";
import { ApiError } from "../../lib/api.ts";
import { Field } from "../../components/Field.tsx";
import { type EntitySchemaVersion, type EntityType, entityTypeIcons } from "@contracts/entity-type.ts";
import { useWriteAttempt, writeErrorMessage } from "../../lib/write-attempt.ts";
import { EntityTypeIcon } from "../entity/EntityTypeIcon.tsx";
export function EntityTypeSettings() {
  const { type_id } = useParams();
  return <EntityTypeSettingsEditor key={type_id ?? "create"} type_id={type_id} />;
}
function EntityTypeSettingsEditor({ type_id }: { type_id?: string }) {
  const api = useApi();
  const requestScope = useRequestScope();
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
  const [definitions] = useState(() => createMaterialDefinition(api, type_id));
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
  const { attempt, busy, uncertain } = useWriteAttempt<EntityType>();
  const readLatestBasics = async () => {
    if (!type_id || busy || uncertain || latestBusy) return;
    setError("");
    try {
      await definitions.readLatestBasics();
      if (!mounted.current) return;
      attempt.reset();
      if (session) invalidateEntityTypeCatalog(requestScope);
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
  const navigationLocked = anyBusy || uncertain || identityState.uncertain || schemaState.uncertain ||
    jobState.uncertain;
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
        setError(e instanceof Error ? e.message : "이전 적용 버전을 읽지 못했습니다.");
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
    if (
      busy || schemaState.busy || latestBusy || basicConflict ||
      (!dirty && !uncertain)
    ) return;
    setError("");
    setMessage("");
    const current = {
      method: type_id ? "PATCH" : "POST",
      path: type_id ? `/entity-types/${type_id}` : "/entity-types",
      input: type_id ? definitions.basicSaveInput() : { label, icon_id: icon, representative_label: representative },
    };
    try {
      const saved = await attempt.run(() =>
        api<EntityType>(
          current.method,
          current.path,
          current.input,
          undefined,
          attempt.requestKey(),
        )
      );
      if (!saved || !mounted.current) return;
      if (session) invalidateEntityTypeCatalog(requestScope);
      if (type_id) {
        definitions.acceptBasicSave(saved);
      } else {
        definitions.cancelBasics();
        setRepresentative("이름");
      }
      setMessage("자료 종류를 저장했습니다.");
      if (type_id) {
        try {
          await definitions.refresh();
        } catch {
          if (mounted.current) {
            setError("자료 종류를 저장했습니다. 최신 정의를 불러오지 못했습니다. 정의를 다시 조회하세요.");
          }
        }
      }
      if (!type_id) {
        requestAnimationFrame(() => {
          if (mounted.current) {
            navigate(`/settings/entity-types/${saved.id}`, { state: { materialTypeFocus: true } });
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
      <section className="min-w-0 flex w-full flex-col gap-6 max-w-6xl">
        <Alert role="status"><AlertDescription>불러오는 중…</AlertDescription></Alert>
      </section>
    );
  }
  return (
    <section
      className="min-w-0 flex w-full flex-col gap-6 max-w-6xl"
      aria-labelledby="entity-types-title"
    >
      <MaterialSettingsHeading section="types" id="entity-types-title" />

      {(type_id || items.length > 0) && (
        <div className="flex flex-wrap items-center gap-3">
          <Field label="자료 종류 선택" hideLabel>
            {(props) => (
              <NativeSelect
                {...props}

                ref={selector}
                value={type_id ?? ""}
                disabled={anyBusy}
                onChange={(event) =>
                  navigate(
                    event.target.value ? `/settings/entity-types/${event.target.value}` : "/settings/entity-types",
                    { state: { materialTypeFocus: true } },
                  )}
              >
                {!type_id && <NativeSelectOption value="" disabled>기존 종류 선택</NativeSelectOption>}
                {type_id && !items.some((item) => item.id === type_id) && (
                  <NativeSelectOption value={type_id}>
                    {type?.label ?? "자료 종류 읽는 중…"}
                  </NativeSelectOption>
                )}
                {items.map((item) => (
                  <NativeSelectOption key={item.id} value={item.id}>
                    {item.label}
                    {item.archived ? " (보관)" : ""}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </Field>
          {type_id && (
            <Button variant="outline" className="h-auto max-w-full whitespace-normal" asChild><Link
              to="/settings/entity-types"
              state={{ materialTypeFocus: true }}
            >
              종류 추가
            </Link></Button>
          )}
          {!loading && type_id && (
            <Button variant="outline" className="h-auto max-w-full whitespace-normal" asChild><Link to={`/settings/relations?type_id=${encodeURIComponent(type_id)}`}>
              이 자료의 연결 설정
            </Link></Button>
          )}
        </div>
      )}
      {loading && <Alert role="status"><AlertDescription>불러오는 중…</AlertDescription></Alert>}
      {!catalog.types && !catalog.error && <Alert role="status"><AlertDescription>자료 종류를 읽는 중…</AlertDescription></Alert>}
      {catalog.error && (
        <Alert variant="destructive" role="alert" className="text-sm text-destructive"><AlertDescription>
          자료 종류를 읽지 못했습니다.{" "}
          <Button variant="ghost" type="button"  onClick={catalog.retry}><RotateCcwIcon data-icon="inline-start" />
            자료 종류 다시 조회
          </Button>
        </AlertDescription></Alert>
      )}
      {error && <Alert variant="destructive" role="alert" className="text-sm text-destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      {error && !loading && (!type_id || !type) && (
        <Button variant="ghost" type="button"  onClick={() => void retryRead()}><RotateCcwIcon data-icon="inline-start" />
          조회 다시 시도
        </Button>
      )}
      {message && <Alert role="status"><AlertDescription>{message}</AlertDescription></Alert>}
      {!loading && (!type_id || type) && (
        <MaterialSettingsSection
          title={type_id ? "기본 정보" : "자료 종류 만들기"}
          description="자료 종류의 이름과 아이콘을 정합니다."
          summary={type?.archived ? "보관" : undefined}
          state={{ dirty, busy, uncertain, error: !!error }}
          initialOpen={!type_id}
        >
          <form
            className="flex min-w-0 flex-col gap-5"
            aria-label={type_id ? "기본 정보" : "자료 종류 만들기"}
            aria-busy={busy || latestBusy}
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            {latestBasics && (
              <Alert className="text-sm text-muted-foreground" role="status"><AlertDescription>
                최신 저장값: {latestBasics.label} ·{" "}
                {entityTypeIcons.find((value) => value.id === latestBasics.icon_id)?.label} ·{" "}
                {latestBasics.archived ? "보관" : "사용 중"} · 버전{" "}
                {latestBasics.schema_version}. 변경한 입력은 유지했습니다. 비교한 뒤 기본 정보를 저장하거나 변경 취소로
                최신 저장값을 사용하세요.
              </AlertDescription></Alert>
            )}
            <FieldSet
              className="min-w-0 grid gap-4 sm:grid-cols-2 [&_dt]:text-sm [&_dt]:text-muted-foreground [&_dd]:min-w-0 [&_dd]:[overflow-wrap:anywhere]"
              disabled={busy || uncertain || latestBusy}
            >
              <Field label="자료 종류 이름">
                {(props) => (
                  <Input
                    {...props}
                    ref={type_id ? undefined : creationName}

                    required
                    maxLength={80}
                    value={label}
                    onChange={(e) => definitions.editBasic("label", e.target.value)}
                  />
                )}
              </Field>
              <FieldSet className="col-span-full">
                <FieldLegend className="text-sm font-medium">아이콘</FieldLegend>
                <ToggleGroup type="single" value={icon} onValueChange={value => { if(value) definitions.editBasic("icon", value); }} aria-label="자료 종류 아이콘" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {entityTypeIcons.map(item => <ToggleGroupItem key={item.id} value={item.id} aria-label={item.label} className="justify-start"><EntityTypeIcon id={item.id} /><span>{item.label}</span></ToggleGroupItem>)}
                </ToggleGroup>
              </FieldSet>
              {!type_id && (
                <Field label="대표 입력 항목 이름">
                  {(props) => (
                    <Input
                      {...props}

                      required
                      maxLength={80}
                      value={representative}
                      onChange={(e) => setRepresentative(e.target.value)}
                    />
                  )}
                </Field>
              )}
              {type_id && (
                <FieldLabel className="flex min-h-11 cursor-pointer items-center gap-3">
                  <Checkbox

                    checked={archived}
                    onCheckedChange={(checked) => definitions.editBasic("archived", checked === true)}
                  />{" "}
                  자료 종류 보관 (기존 자료와 연결은 유지)
                </FieldLabel>
              )}
            </FieldSet>
            <div className="flex flex-col gap-3 pt-4">
              {uncertain && (
                <Alert className="text-sm text-muted-foreground" role="status"><AlertDescription>
                  저장 여부를 알 수 없습니다. 같은 요청으로 다시 확인하세요. 새로고침 후에는 현재 상태를 조회한 뒤 새
                  작업을 시작하세요.
                </AlertDescription></Alert>
              )}
              <div className="flex flex-wrap items-center justify-end gap-2">
                <Button variant="outline"
                  type="button"

                  disabled={busy || uncertain || latestBusy || basicConflict || !dirty}
                  onClick={cancel}
                  aria-label="변경 취소"
                >
                  취소
                </Button>
                {basicConflict && (
                  <Button variant="outline"
                    type="button"

                    disabled={busy || uncertain || latestBusy}
                    onClick={() => void readLatestBasics()}
                  >
                    {latestBusy ? "최신 기본 정보 읽는 중…" : "최신 기본 정보 확인"}
                  </Button>
                )}
                <Button variant="default"

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
                </Button>
              </div>
            </div>
          </form>
        </MaterialSettingsSection>
      )}
      {!loading && type_id && type && (
        <TypeIdentitySettings
          typeId={type_id}
          onState={identityStateChange}
          disabled={busy || uncertain || schemaState.busy ||
            schemaState.uncertain || jobState.busy ||
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
          jobDisabled={busy || uncertain || identityState.busy ||
            identityState.uncertain || schemaState.busy ||
            schemaState.uncertain}
          onApplied={definitions.published}
          onState={schemaStateChange}
          disabled={busy || uncertain || identityState.busy ||
            identityState.uncertain || jobState.busy ||
            jobState.uncertain}
        />
      )}
      <MaterialSettingsProtection
        dirty={protectedDraft}
        busy={navigationLocked}
        typeId={type_id}
        jobId={selectedJob}
        protectJob={jobState.dirty || jobState.uncertain}
      />
    </section>
  );
}

import { DataFields } from "@/components/DataFields";
import { useSettingsAccess } from "./workspace-settings-access.tsx";
import { isCivilDateInput } from "../../lib/civil-date-input.ts";
import { BusinessTable, BusinessCell, BusinessDetails, BusinessDisclosureCell, BusinessRow } from "../../components/BusinessTable.tsx";
import { ArrowDownIcon, ArrowUpIcon, ChevronDownIcon, ChevronRightIcon, PlusIcon, RotateCcwIcon, Trash2Icon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { FieldSet, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "../../components/ui/button.tsx";
import { Input } from "../../components/ui/input.tsx";
import { DateInput } from "../../components/DateInput.tsx";
import { NativeSelect, NativeSelectOption } from "../../components/ui/native-select.tsx";
import { Textarea } from "../../components/ui/textarea.tsx";
import { SchemaExport } from "./SchemaExport.tsx";
import { fieldChoices } from "../../lib/schema-document.ts";
import { schemaPresentation } from "../../lib/schema-document.ts";

import { MaterialSettingsSection } from "./MaterialSettingsSection.tsx";
import type { EntitySchemaChange } from "@contracts/entity-schema-change.ts";
import { materialSettingsPath } from "./material-settings-path.ts";
import { fieldTypeLabel, schemaChangeLabels, schemaDiffValueLabel } from "./schema-labels.ts";
import { SchemaSearchTextSetting } from "./SchemaSearchTextSetting.tsx";
import { SchemaTitleTemplateSetting } from "./SchemaTitleTemplateSetting.tsx";
import {
  migrationActive,
  migrationLabels,
  SchemaMigrationJob,
  useMigrationHistory,
} from "./SchemaMigrationJobs.tsx";
import { Link, useLocation, useNavigate } from "../../lib/workspace-router.tsx";
import { ConversionEditor } from "./ConversionEditor.tsx";
import { type ReactNode, useEffect, useRef, useState } from "react";
import type {
  EntityField,
  EntitySchemaVersion,
  EntitySchemaVersionSummary,
  EntityType,
} from "@contracts/entity-type.ts";
import { useSchemaChangeEditor } from "./schema-change-editor.ts";
import type { EditState } from "./schema-change-editor.ts";
import { Field } from "../../components/Field.tsx";
import { fieldInputPolicy } from "./field-input-policy.ts";
import { CollectionItem, CollectionList  } from "../../components/Collection.tsx";
import { SchemaDefinitionRead } from "./SchemaDefinitionRead.tsx";
import { SchemaVersionRead } from "./SchemaVersionRead.tsx";
import { SchemaAnalysisErrors, SchemaChangeDiff, SchemaChangeRead } from "./SchemaChangeRead.tsx";
import { schemaHistoryRows } from "./schema-history.ts";
import type { EntitySchemaMigration } from "@contracts/entity-schema-migration.ts";
import type { MaterialSectionState } from "./MaterialSettingsSection.tsx";
import { ConfirmDialog } from "../../components/Modal.tsx";
import { fieldType } from "../entity/property-fields.tsx";
const noJobState = () => {};
const optionLabel = (
  labels: Record<string, string> | undefined,
  code: string,
) => labels && Object.hasOwn(labels, code) ? labels[code] : code;
const numericConditionNames: Record<string, string> = {
  minLength: "최소 길이",
  maxLength: "최대 길이",
  minimum: "최소값",
  maximum: "최대값",
  multipleOf: "배수",
  default: "기본값",
};
export function SchemaEditor(
  {
    type,
    definition,
    onApplied,
    onState,
    disabled = false,
    betweenSections,
    historyVersions = [],
    selectedVersion,
    historyBefore = null,
    historyBusy = false,
    onMoreVersions,
    selectedJob,
    historyJobState,
    onMigrationApplied,
    jobErrors = {},
    onJobState,
    jobDisabled = false,
    historyInitiallyOpen = false,
  }: {
    type: EntityType;
    definition: EntitySchemaVersion;
    onApplied: (change?: EntitySchemaChange) => Promise<string>;
    onState: (state: EditState) => void;
    disabled?: boolean;
    betweenSections?: ReactNode;
    historyVersions?: EntitySchemaVersionSummary[];
    selectedVersion?: EntitySchemaVersion | null;
    historyBefore?: number | null;
    historyBusy?: boolean;
    onMoreVersions?: () => Promise<void>;
    selectedJob?: string;
    historyJobState?: MaterialSectionState;
    onMigrationApplied?: (job: EntitySchemaMigration) => Promise<string>;
    jobErrors?: Record<string, string>;
    onJobState?: (state: MaterialSectionState) => void;
    jobDisabled?: boolean;
    historyInitiallyOpen?: boolean;
  },
) {
  const { canWrite } = useSettingsAccess();
  disabled = disabled || !canWrite;
  jobDisabled = jobDisabled || !canWrite;
  const location = useLocation(), navigate = useNavigate();
  const jobs = useMigrationHistory(type.id, selectedJob);
  const [expandedRow, setExpandedRow] = useState<string>();
  const [selectedJobOpen, setSelectedJobOpen] = useState(true);
  const [versionErrors, setVersionErrors] = useState<Record<string, string>>(
    {},
  );
  const [propertiesOpen, setPropertiesOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(historyInitiallyOpen);
  const [reviewOpen, setReviewOpen] = useState(true);
  const [discardConfirm, setDiscardConfirm] = useState(false);
  const [openFields, setOpenFields] = useState<string[]>([]);
  const [advancedFields, setAdvancedFields] = useState<string[]>([]);
  const [deleteKey, setDeleteKey] = useState<string | null>(null);
  const propertiesHeading = useRef<HTMLHeadingElement>(null);
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const fieldElements = useRef<Record<string, { row?: HTMLElement | null; body?: HTMLElement | null }>>({});
  const onFieldKeysChanged = (replacements: Record<string, string>) => {
    setOpenFields((keys) => keys.map((key) => replacements[key] ?? key));
    setAdvancedFields((keys) => keys.map((key) => replacements[key] ?? key));
  };
  const onInvalidField = (
    key: string,
    includeSelect: boolean,
    condition?: string,
  ) => {
    setPropertiesOpen(true);
    setAdvancedFields((keys) => keys.includes(key) ? keys : [...keys, key]);
    setOpenFields((keys) => keys.includes(key) ? keys : [...keys, key]);
    requestAnimationFrame(() => {
      const element = fieldElements.current[key]?.body;
      element?.scrollIntoView({ block: "nearest" });
      if (!element) return;
      const input = [...element.querySelectorAll<HTMLInputElement>("[data-schema-setting]")].find((input) =>
        input.dataset.schemaSetting === condition
      ) ??
        element.querySelector<HTMLInputElement>(
          includeSelect ? "input:not([disabled]),select:not([disabled])" : "input:not([disabled])",
        );
      input?.scrollIntoView({ block: "nearest" });
      input?.focus();
    });
  };
  const editor = useSchemaChangeEditor({
    type,
    definition,
    onApplied,
    onState,
    disabled,
    jobs: jobs.items,
    onNavigate: navigate,
    selectionSearch: location.search,
    onFieldKeysChanged,
    onInvalidField,
    onReviewed: () => {
      setPropertiesOpen(true);
      // Keep ordinary schema edits in place; impact details remain available in history.
      requestAnimationFrame(() => propertiesHeading.current?.focus({ preventScroll: true }));
    },
  });
  const {
    draft,
    fieldStates,
    removedFields,
    fieldOrder,
    changeCount,
    unsupportedNumericInputs,
    plan,
    changes,
    numericDrafts,
    migration,
    fieldError,
    error,
    message,
    dirty,
    busy,
    uncertain,
    readBusy,
    startError,
    inputsDisabled,
    restartedFrom,
    planSyncNeeded,
  } = editor.view;
  const {
    editField,
    editNumeric,
    editFlag,
    moveField,
    loadPlan,
  } = editor;
  useEffect(() => {
    const explicitlySelected = new URLSearchParams(location.search).get("change_id") === plan?.id;
    const needsImpactReview = plan?.change_kind === "migration_required" || !!plan?.recovery || (plan?.analysis?.failed ?? 0) > 0;
    if (plan?.id && (explicitlySelected || needsImpactReview)) {
      setHistoryOpen(true);
      setReviewOpen(true);
    }
  }, [plan?.id, plan?.change_kind, plan?.recovery, plan?.analysis?.failed, location.search]);
  useEffect(() => {
    if (historyInitiallyOpen) setHistoryOpen(true);
  }, [historyInitiallyOpen]);
  useEffect(() => {
    if (selectedJob) {
      setHistoryOpen(true);
      setSelectedJobOpen(true);
    }
  }, [selectedJob]);
  const historyRows = schemaHistoryRows(
    jobs.selectedChange && !changes.some((c) => c.id === jobs.selectedChange!.id)
      ? [...changes, jobs.selectedChange]
      : changes,
    selectedVersion && !historyVersions.some((v) => v.schema_version === selectedVersion.schema_version)
      ? [...historyVersions, selectedVersion]
      : historyVersions,
    jobs.items,
  );
  const activeJob = jobs.items.find(migrationActive);
  const { actions } = editor;
  const primaryAction = actions.history;
  const actionLabels = {
    "sync-pending": "상태 확인 중…",
    "sync-required": "상태 확인 필요",
    retry: "같은 요청 다시 확인",
    restart: "최신 기준으로 다시 검토",
    review: "보완 내용 검토",
    analyzing: "검토 중…",
    analyze: "변경 검토",
    reanalyze: "검토 재시도",
    publish: "변경 적용",
    migration: "값 변환 시작",
  };
  const openEditing = () => {
    setPropertiesOpen(true);
    requestAnimationFrame(() => {
      propertiesHeading.current?.scrollIntoView({ block: "start" });
      propertiesHeading.current?.focus();
    });
  };
  const moveInput = (key: string, offset: number) => {
    moveField(key, offset);
    requestAnimationFrame(() => {
      const element = fieldElements.current[key]?.row;
      const buttons = element?.querySelectorAll<HTMLButtonElement>(
        "[data-schema-order-actions] button",
      );
      const same = buttons?.[offset < 0 ? 0 : 1];
      if (same && !same.matches(":disabled")) same.focus();
      else {(element?.querySelector<HTMLButtonElement>(
          "[data-schema-order-actions] button:not(:disabled)",
        ) ??
          element?.querySelector<HTMLButtonElement>("[data-schema-disclosure]:not(:disabled)"))?.focus();}
    });
  };
  const newEditing = async () => {
    if (busy || uncertain || dirty || readBusy || disabled || !await editor.refreshDefinition()) return;
    requestAnimationFrame(() => {
      if (!propertiesHeading.current) return;
      editor.startNewChange();
      const params = new URLSearchParams(location.search);
      params.delete("change_id");
      navigate(`${location.pathname}?${params}`);
      openEditing();
    });
  };
  const draftOrder = schemaPresentation(draft).order;
  return (
    <div className="flex min-w-0 flex-col gap-6">
      {error && <Alert variant="destructive" role="alert" className="text-sm text-destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      {message && <Alert role="status"><AlertDescription>{message}</AlertDescription></Alert>}
      <div className="grid min-w-0 gap-6">
        <section
          className="flex min-w-0 flex-col gap-4"
          aria-label="입력 항목"
        >
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
            <h2
              className="text-base font-semibold"
              id="schema-properties-title"
              ref={propertiesHeading}
              tabIndex={-1}
            >
              <Button variant="ghost"
                className="h-auto min-h-[max(2.75rem,44px)] max-w-full justify-start px-0 whitespace-normal text-left"
                type="button"
                aria-expanded={propertiesOpen}
                aria-label="입력 항목"
                aria-controls="schema-property-inputs"
                onClick={() => {
                  if (
                    canWrite && !propertiesOpen && plan && ["applied", "cancelled", "stale"].includes(plan.status)
                  ) void newEditing();
                  else setPropertiesOpen(!propertiesOpen);
                }}
              >
                {propertiesOpen ? <ChevronDownIcon data-icon="inline-start" /> : <ChevronRightIcon data-icon="inline-start" />}
                <span>입력 항목</span>
                <span className="text-sm text-muted-foreground">
                  {busy
                    ? "저장 중…"
                    : uncertain
                    ? "결과 확인 필요"
                    : dirty
                    ? "수정 중"
                    : `${schemaPresentation(draft).order.length}개 항목`}
                </span>
              </Button>
            </h2>
            <div className="flex max-w-full flex-wrap items-center gap-2">
              <Button variant="ghost"

                type="button"
                disabled={inputsDisabled ||
                  Boolean(plan?.recovery) || Object.keys(draft.schema.properties).length >= 64}
                onClick={() => {
                  setPropertiesOpen(true);
                  const key = editor.addField();
                  if (key) setOpenFields((keys) => [...keys, key]);
                }}
              ><PlusIcon data-icon="inline-start" />
                항목 추가
              </Button>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            상품명·가격·조리 시간처럼 자료에 입력할 내용을 정합니다.
          </p>
          {propertiesOpen && !canWrite && <SchemaDefinitionRead definition={definition} />}
          <div hidden={!propertiesOpen || !canWrite} className="min-w-0">
            <FieldSet
              id="schema-property-inputs"
              hidden={!propertiesOpen}
              className="min-w-0"
              disabled={inputsDisabled}
            >
              <SchemaTitleTemplateSetting draft={draft} saved={definition} disabled={inputsDisabled || Boolean(plan?.recovery)} readOnly={!canWrite} onChange={editor.editTitleTemplate} />
              <CollectionList view="table" label="입력 항목 목록" columns={["입력 항목", "설정", "순서"]}>
                {fieldOrder.map((key) => {
                  const removed = removedFields.find(field => field.key === key);
                  if (removed) return <CollectionItem key={`removed-${key}`}>
                    <BusinessRow aria-label={`${removed.field.title || key} 삭제 예정 입력 항목`}>
                      <BusinessDisclosureCell />
                      <BusinessCell index={0}><span className="wrap-anywhere">{removed.field.title || key}</span></BusinessCell>
                      <BusinessCell index={1}><Badge variant="destructive">삭제 예정</Badge></BusinessCell>
                      <BusinessCell index={2}><Button variant="outline" type="button" disabled={Boolean(plan?.recovery) || Object.keys(draft.schema.properties).length >= 64}
                        aria-label={`${removed.field.title || key} 삭제 취소`} onClick={() => {
                          editor.restoreField(key);
                          setOpenFields(keys => [...keys, key]);
                          requestAnimationFrame(() => fieldElements.current[key]?.body?.querySelector<HTMLInputElement>('input[data-schema-setting="title"]')?.focus());
                        }}>삭제 취소</Button></BusinessCell>
                    </BusinessRow>
                  </CollectionItem>;
                  const index = draftOrder.indexOf(key);
                  const f = draft.schema.properties[key],
                    scalar = fieldType(f) ?? "string";
                  const toggleField = () =>
                    setOpenFields((keys) =>
                      keys.includes(key) ? keys.filter((value) => value !== key) : [...keys, key]
                    );
                  const expanded = openFields.includes(key);
                  const fieldSummary = (
                    <span className="flex max-w-full flex-wrap items-center gap-1 text-sm text-muted-foreground">
                      {!expanded && <span>{fieldTypeLabel(f)}</span>}
                      {draft.schema.required.includes(key) && <Badge variant="secondary">필수</Badge>}
                      {schemaPresentation(draft).archived.includes(key) && (
                        <Badge variant="secondary">사용 중지</Badge>
                      )}
                      {fieldStates[key] && <Badge>{fieldStates[key]}</Badge>}
                      {fieldError === key && (
                        <span className="text-sm text-destructive">
                          오류
                        </span>
                      )}
                    </span>
                  );
                  return (
                    <CollectionItem key={key}>
                      <BusinessRow aria-label={`${f.title || "새 항목"} 입력 항목`} data-expanded={expanded || undefined}
                        ref={element => { fieldElements.current[key] = { ...fieldElements.current[key], row: element }; }}>
                        <BusinessDisclosureCell><Button size="icon" data-schema-disclosure variant="ghost" type="button"
                          aria-label={`${f.title || "새 항목"} 항목 ${expanded ? "접기" : "펼치기"}`} aria-expanded={expanded} aria-controls={`schema-field-${key}`} onClick={toggleField}>
                          {expanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
                        </Button></BusinessDisclosureCell>
                        <BusinessCell index={0}><h3><Button variant="link" type="button" className="h-auto min-h-[max(2.75rem,44px)] max-w-full justify-start px-0 text-left whitespace-normal wrap-anywhere"
                          aria-label={`${f.title || "새 항목"} 입력 항목 편집`} aria-expanded={expanded} aria-controls={`schema-field-${key}`}
                          onClick={() => {
                            toggleField();requestAnimationFrame(() => {
                              const input = fieldElements.current[key]?.body?.querySelector<HTMLInputElement>('input[data-schema-setting="title"]:not(:disabled)');
                              (input ?? fieldElements.current[key]?.row?.querySelector<HTMLButtonElement>('[data-schema-disclosure]:not(:disabled)'))?.focus({preventScroll:true});
                            });
                          }}><span className="min-w-0 wrap-anywhere">{f.title || "새 항목"}</span></Button></h3></BusinessCell>
                        <BusinessCell index={1}>{fieldSummary}</BusinessCell>
                        <BusinessCell index={2}>                          <div data-schema-order-actions className="flex min-w-0 flex-wrap gap-1">
                            <Button variant="ghost"
                              type="button"

                              aria-label={`${f.title || "새 항목"} 위로`}
                              disabled={index === 0 || Boolean(plan?.recovery)}
                              onClick={() => moveInput(key, -1)}
                            >
                              <ArrowUpIcon />
                            </Button>
                            <Button variant="ghost"
                              type="button"

                              aria-label={`${f.title || "새 항목"} 아래로`}
                              disabled={index === schemaPresentation(draft).order.length - 1 || Boolean(plan?.recovery)}
                              onClick={() => moveInput(key, 1)}
                            >
                              <ArrowDownIcon />
                            </Button>
                          </div>
</BusinessCell>
                      </BusinessRow>
                      <BusinessDetails id={`schema-field-${key}`} hidden={!expanded} role="region" aria-label={`${f.title || "새 항목"} 입력 항목`}
                        ref={element => { fieldElements.current[key] = { ...fieldElements.current[key], body: element }; }}>
                                  <Field fullWidth label="항목 이름">
                                    {(nameProps) => (
                                      <Input
                                        {...nameProps}

                                        maxLength={80}
                                        data-schema-setting="title"
                                        value={f.title ?? ""}
                                        disabled={Boolean(plan?.recovery)}
                                        onChange={(event) => editField(key, { ...f, title: event.target.value })}
                                      />
                                    )}
                                  </Field>
                        <FieldSet
                          className="min-w-0 grid gap-4 sm:grid-cols-2 [&_dt]:text-sm [&_dt]:text-muted-foreground [&_dd]:min-w-0 [&_dd]:[overflow-wrap:anywhere]"
                          hidden={!openFields.includes(key)}
                          disabled={Boolean(plan?.recovery)}
                        >
                          <Field label="데이터 타입">
                            {(p) => (
                              <NativeSelect
                                {...p}

                                data-schema-setting="type"
                                value={fieldChoices(f) ? "select" : f.format === "date" ? "date" : scalar}
                                onChange={(e) => {
                                  const value = e.target.value;
                                  editField(
                                    key,
                                    fieldInputPolicy({
                                      type: value === "date" || value === "select" ? "string" : value as "string",
                                      "x-order": f["x-order"],
                                      "x-list-order": f["x-list-order"],
                                      "x-representative": f["x-representative"],
                                      "x-show-in-list": f["x-show-in-list"],
                                      ...(value === "string" ? { "x-search-text": f["x-search-text"] } : {}),
                                      deprecated: f.deprecated,
                                      readOnly: f.readOnly,
                                      examples: f.examples,
                                      title: f.title,
                                      description: f.description,
                                      ...(value === "date"
                                        ? { format: "date" as const }
                                        : value === "select"
                                        ? { oneOf: [{ const: "option_1", title: "선택 항목 1" }] }
                                        : {}),
                                      ...(key === schemaPresentation(draft).representative ? { minLength: 1 } : {}),
                                    }, draft.schema.required.includes(key)),
                                  );
                                }}
                              >
                                <NativeSelectOption value="string">텍스트</NativeSelectOption>
                                <NativeSelectOption value="integer">정수</NativeSelectOption>
                                <NativeSelectOption value="number">숫자</NativeSelectOption>
                                <NativeSelectOption value="date">날짜</NativeSelectOption>
                                <NativeSelectOption value="boolean">참·거짓</NativeSelectOption>
                                <NativeSelectOption value="select">단일 선택</NativeSelectOption>
                              </NativeSelect>
                            )}
                          </Field>
                          {fieldChoices(f) && (
                            <div className="flex min-w-0 flex-col gap-3 col-span-full">
                              <h4 className="text-base font-semibold">선택 항목</h4>
                              {fieldChoices(f)!.filter((value) => value !== null).map((
                                code,
                                i,
                              ) => (
                                <div className="flex min-w-0 flex-wrap items-end gap-2 [&>div]:flex-1" key={code!}>
                                  <Field label={`선택 항목 ${i + 1}`}>
                                    {(props) => (
                                      <Input
                                        {...props}

                                        maxLength={80}
                                        value={optionLabel(
                                          schemaPresentation(draft).option_labels[key],
                                          code!,
                                        )}
                                        onChange={(event) =>
                                          editor.editOptionLabel(
                                            key,
                                            code!,
                                            event.target.value,
                                          )}
                                      />
                                    )}
                                  </Field>
                                  <Button variant="outline"
                                    type="button"

                                    aria-label={`선택 항목 ${i + 1} 제거`}
                                    disabled={fieldChoices(f)!.filter((value) => value !== null).length <= 1}
                                    onClick={() =>
                                      editField(key, {
                                        ...f,
                                        oneOf: f.oneOf!.filter((option) => option.const !== code),
                                      })}
                                  >
                                    제거
                                  </Button>
                                </div>
                              ))}
                              <Button variant="ghost"

                                type="button"
                                disabled={fieldChoices(f)!.filter((value) => value !== null).length >= 128}
                                onClick={() => {
                                  let number = 1;
                                  while (fieldChoices(f)!.includes(`option_${number}`)) {
                                    number++;
                                  }
                                  editField(key, {
                                    ...f,
                                    oneOf: [...f.oneOf!, {
                                      const: `option_${number}`,
                                      title: `선택 항목 ${
                                        f.oneOf!.filter((option) => option.const !== null).length + 1
                                      }`,
                                    }],
                                  });
                                }}
                              ><PlusIcon data-icon="inline-start" />
                                선택 항목 추가
                              </Button>
                              <p className="text-sm text-muted-foreground">
                                선택 항목을 제거하면 기존 자료의 해당 값을 검토해야 합니다.
                              </p>
                            </div>
                          )}
                          <SchemaSearchTextSetting
                            field={f}
                            disabled={Boolean(plan?.recovery)}
                            onChange={(field) => editField(key, field)}
                          />
                          <Collapsible
                            className="min-w-0 col-span-full"
                            open={advancedFields.includes(key)}
                            onOpenChange={(open) => {
                              setAdvancedFields((keys) =>
                                open
                                  ? keys.includes(key) ? keys : [...keys, key]
                                  : keys.filter((value) => value !== key)
                              );
                            }}
                          >
                            <CollapsibleTrigger asChild><Button type="button" variant="ghost" className="h-auto min-h-[max(2.75rem,44px)] w-full justify-start whitespace-normal text-left">추가 설정</Button></CollapsibleTrigger><CollapsibleContent forceMount className="min-w-0 pt-3 data-[state=closed]:hidden">
                            <FieldGroup className="flex min-w-0 flex-col gap-5 grid gap-4 sm:grid-cols-2 [&_dt]:text-sm [&_dt]:text-muted-foreground [&_dd]:min-w-0 [&_dd]:[overflow-wrap:anywhere]">
                              <FieldLabel className="flex min-h-11 cursor-pointer items-center gap-3">
                                <Checkbox

                                  checked={draft.schema.required.includes(key)}
                                  onCheckedChange={(checked) => editFlag(key, "required", checked === true)}
                                />{" "}
                                필수 입력
                              </FieldLabel>

                              <FieldLabel className="flex min-h-11 cursor-pointer items-center gap-3">
                                <Checkbox

                                  checked={!!f.readOnly}
                                  aria-label={`${f.title || "새 항목"} 읽기 전용`}
                                  onCheckedChange={(checked) => editField(key, { ...f, readOnly: checked === true })}
                                />{" "}
                                읽기 전용
                              </FieldLabel>
                              <Field fullWidth label="설명">
                                {(p) => (
                                  <Textarea
                                    {...p}

                                    maxLength={1000}
                                    value={f.description ?? ""}
                                    onChange={(e) =>
                                      editField(key, {
                                        ...f,
                                        description: e.target.value,
                                      })}
                                  />
                                )}
                              </Field>
                              {unsupportedNumericInputs.filter(([address]) => address.startsWith(key + ":")).map(
                                ([address, raw]) => {
                                  const label = numericConditionNames[address.split(":")[1]];
                                  return (
                                    <div key={address}>
                                      <p className="text-sm text-destructive">
                                        현재 타입에서 사용할 수 없는 이전 조건 입력입니다. 입력을 확인하고 제거하세요.
                                      </p>
                                      <Field label={`이전 ${label} 입력`}>
                                        {(props) => (
                                          <Input
                                            {...props}

                                            value={raw}
                                            readOnly
                                          />
                                        )}
                                      </Field>
                                      <Button variant="ghost"
                                        type="button"
                                        aria-label={`${f.title ?? "입력 항목"} 이전 ${label} 입력 제거`}
                                        onClick={() => editor.removeNumericInput(address)}
                                      >
                                        이전 조건 입력 제거
                                      </Button>
                                    </div>
                                  );
                                },
                              )}
                              {scalar === "string" && !f.format && (
                                <div className="grid min-w-0 gap-4 sm:grid-cols-2 [&_dt]:text-sm [&_dt]:text-muted-foreground [&_dd]:min-w-0 [&_dd]:[overflow-wrap:anywhere] col-span-full">
                                  {(["minLength", "maxLength"] as const).map((
                                    name,
                                  ) => (
                                    <Field
                                      key={name}
                                      label={name === "minLength" ? "최소 길이" : "최대 길이"}
                                    >
                                      {(p) => (
                                        <Input
                                          {...p}

                                          type="text"
                                          inputMode="decimal"
                                          min={0}
                                          max={4096}
                                          data-schema-setting={name}
                                          value={numericDrafts[key + ":" + name] ?? f[name] ?? ""}
                                          onChange={(e) => editNumeric(key, name, e.target.value)}
                                        />
                                      )}
                                    </Field>
                                  ))}
                                </div>
                              )}
                              {["integer", "number"].includes(scalar) && (
                                <div className="grid min-w-0 gap-4 sm:grid-cols-2 [&_dt]:text-sm [&_dt]:text-muted-foreground [&_dd]:min-w-0 [&_dd]:[overflow-wrap:anywhere] col-span-full">
                                  {(["minimum", "maximum", "multipleOf"] as const).map((name) => (
                                    <Field key={name} label={numericConditionNames[name]}>
                                      {(p) => (
                                        <Input
                                          {...p}

                                          type="text"
                                          inputMode="decimal"
                                          step="any"
                                          data-schema-setting={name}
                                          value={numericDrafts[key + ":" + name] ?? f[name] ?? ""}
                                          onChange={(e) => editNumeric(key, name, e.target.value)}
                                        />
                                      )}
                                    </Field>
                                  ))}
                                </div>
                              )}
                              <Field label="생성 기본값 (기존 자료에는 채우지 않음)">
                                {(p) => (
                                  <NativeSelect
                                    {...p}

                                    value={f.default === undefined ||
                                        f.default === null
                                      ? "unset"
                                      : "value"}
                                    onChange={(e) =>
                                      editField(key, {
                                        ...f,
                                        default: e.target.value === "unset"
                                          ? undefined
                                          : e.target.value === "null"
                                          ? null
                                          : scalar === "boolean"
                                          ? false
                                          : ["integer", "number"].includes(scalar)
                                          ? 0
                                          : fieldChoices(f)?.find((v) => v !== null) ?? "",
                                      })}
                                  >
                                    <NativeSelectOption value="unset">설정 안 함</NativeSelectOption>
                                    <NativeSelectOption value="value">값 지정</NativeSelectOption>
                                  </NativeSelect>
                                )}
                              </Field>
                              {f.default !== undefined && f.default !== null && (
                                <Field label="기본값" error={f.format === "date" && !isCivilDateInput(String(f.default))
                                  ? "올바른 날짜를 YYYY-MM-DD 형식으로 입력하세요." : undefined}>
                                  {(p) =>
                                    scalar === "boolean"
                                      ? (
                                        <NativeSelect
                                          {...p}

                                          value={String(f.default)}
                                          onChange={(e) =>
                                            editField(key, {
                                              ...f,
                                              default: e.target.value === "true",
                                            })}
                                        >
                                          <NativeSelectOption value="false">거짓</NativeSelectOption>
                                          <NativeSelectOption value="true">참</NativeSelectOption>
                                        </NativeSelect>
                                      )
                                      : fieldChoices(f)
                                      ? (
                                        <NativeSelect
                                          {...p}

                                          value={String(f.default)}
                                          onChange={(e) =>
                                            editField(key, {
                                              ...f,
                                              default: e.target.value,
                                            })}
                                        >
                                          {fieldChoices(f)!.filter((v) => v !== null).map((
                                            code,
                                          ) => (
                                            <NativeSelectOption key={code} value={code!}>
                                              {optionLabel(
                                                schemaPresentation(draft).option_labels[key],
                                                code!,
                                              )}
                                            </NativeSelectOption>
                                          ))}
                                        </NativeSelect>
                                      )
                                      : f.format === "date" ? (
                                        <DateInput
                                          {...p}
                                          label={`${f.title ?? key} 기본값`}
                                          disabled={inputsDisabled}
                                          data-schema-setting="default"
                                          value={numericDrafts[key + ":default"] ?? String(f.default)}
                                          onValueChange={(next) => editField(key, { ...f, default: next })}
                                        />
                                      ) : (
                                        <Input
                                          {...p}

                                          type="text"
                                          inputMode={["integer", "number"].includes(
                                              scalar,
                                            )
                                            ? "decimal"
                                            : undefined}
                                          data-schema-setting="default"
                                          value={numericDrafts[key + ":default"] ?? String(f.default)}
                                          onChange={(e) =>
                                            ["integer", "number"].includes(scalar)
                                              ? editNumeric(
                                                key,
                                                "default",
                                                e.target.value,
                                              )
                                              : editField(key, {
                                                ...f,
                                                default: e.target.value,
                                              })}
                                        />
                                      )}
                                </Field>
                              )}
                              <p className="text-sm text-muted-foreground">
                                사용 중지는 기존 값을 유지합니다. 삭제는 검토·적용 후 반영됩니다.
                              </p>
                              <div className="flex flex-wrap items-center justify-end gap-2">
                                <Button variant="ghost"
                                  type="button"
                                  disabled={key === schemaPresentation(draft).representative}
                                  onClick={() =>
                                    editor.setFieldInactive(
                                      key,
                                      !schemaPresentation(draft).archived.includes(key),
                                    )}
                                >
                                  {schemaPresentation(draft).archived.includes(key) ? "다시 사용" : "사용 중지"}
                                </Button>
                                <Button variant="destructive"

                                  type="button"
                                  disabled={key === schemaPresentation(draft).representative}
                                  onClick={() => setDeleteKey(key)}
                                >
                                  <Trash2Icon data-icon="inline-start" />항목 삭제
                                </Button>
                              </div>
                              {key === schemaPresentation(draft).representative && (
                                <p className="text-sm text-muted-foreground">
                                  다른 항목을 자료 이름으로 선택한 뒤 사용 중지하거나 삭제하세요.
                                </p>
                              )}
                            </FieldGroup>
                          </CollapsibleContent></Collapsible>
                        </FieldSet>
                      </BusinessDetails>
                    </CollectionItem>
                  );
                })}
              </CollectionList>

            </FieldSet>
            <p className="text-sm text-muted-foreground">항목 순서는 입력·상세·목록에 함께 적용됩니다.</p>
            {plan && !["applied", "cancelled"].includes(plan.status) && !actions.review.visible && (
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-3" aria-label="입력 항목 적용 상태">
                <p className="text-sm text-muted-foreground" role="status">
                  {plan.analysis?.status === "queued" || plan.analysis?.status === "running"
                    ? "기존 자료에 미치는 영향을 확인하고 있습니다."
                    : plan.analysis?.status === "succeeded" && !plan.analysis.failed
                    ? "기존 자료 확인 완료 · 적용할 수 있습니다."
                    : "적용 전에 기존 자료에 미치는 영향을 확인하세요."}
                </p>
                <div className="flex max-w-full flex-wrap items-center gap-2">
                  {actions.conversionVisible || plan.analysis?.failed || plan.analysis?.status === "failed" || plan.status === "stale"
                    ? <Button variant="outline" type="button" disabled={busy || uncertain} onClick={() => {
                      setHistoryOpen(true); setReviewOpen(true);
                      requestAnimationFrame(() => { reviewHeading.current?.scrollIntoView({ block: "start" }); reviewHeading.current?.focus(); });
                    }}>영향·보완 내용 확인</Button>
                    : primaryAction && <Button variant="default" type="button" disabled={primaryAction.disabled} onClick={() => void primaryAction.run?.()}>
                      {primaryAction.label ?? actionLabels[primaryAction.kind]}
                    </Button>}
                </div>
              </div>
            )}
            {actions.review.visible && (
              <div className="flex flex-col gap-3 pt-4">
                {(dirty || plan && plan.status !== "applied") && (
                  <p className="text-sm text-muted-foreground">
                    {dirty
                      ? `변경 ${changeCount}개 · 검토 후 자료에 적용됩니다.`
                      : "저장한 변경안입니다. 아직 자료에 적용되지 않았습니다."}
                  </p>
                )}
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <Button variant="outline"

                    disabled={busy || uncertain || !dirty}
                    onClick={editor.cancelEditing}
                  >
                    변경 취소
                  </Button>
                  <Button variant="default"

                    disabled={actions.review.disabled}
                    onClick={() => void actions.review.run()}
                  >
                    {busy ? "처리 중…" : uncertain ? "같은 요청 다시 확인" : "변경 검토"}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
      {betweenSections}
      <MaterialSettingsSection
        title="변경 이력"
        description="적용한 설정과 변경 내용을 확인합니다."
        summary={historyJobState?.uncertain || uncertain
          ? "결과 확인 필요"
          : historyJobState?.busy || busy
          ? "처리 중…"
          : historyJobState?.error || jobs.error ||
              Object.values(jobErrors).some(Boolean) ||
              Object.values(versionErrors).some(Boolean)
          ? "조회 오류 · 확인 필요"
          : historyRows.some((row) => !row.version && row.jobs[0]?.status === "failed")
          ? "값 변환 실패"
          : activeJob
          ? `값 변환 중 · ${activeJob.processed}/${activeJob.total}`
          : changes.some((c) => c.status === "analyzing")
          ? "검토 중"
          : changes.filter((c) => !["applied", "cancelled"].includes(c.status)).length
          ? `미적용 ${changes.filter((c) => !["applied", "cancelled"].includes(c.status)).length}건`
          : `현재 버전 ${definition.schema_version}`}
        open={historyOpen}
        onOpenChange={setHistoryOpen}
      >
        <SchemaExport definition={definition} current />
        <div className="flex min-w-0 flex-col gap-4">
          <CollectionList view="table" label="입력 항목 변경 이력" columns={["변경", "시각", "상태"]}>
            {historyRows.map((row) => {
              const c = row.change;
              const rowJob = row.jobs.find((job) => job.id === selectedJob) ??
                row.jobs.find(migrationActive) ??
                row.jobs[0];
              const isSelectedJob = row.jobs.some((job) => job.id === selectedJob);
              const isOpen = (!!plan && plan.id === row.changeId && reviewOpen) ||
                expandedRow === row.id ||
                (isSelectedJob && selectedJobOpen) ||
                !!selectedVersion &&
                  selectedVersion.schema_version ===
                    row.version?.schema_version;
              const transforming = row.jobs.some(migrationActive);
              const running = row.jobs.find(migrationActive);
              const status = planSyncNeeded && row.changeId === plan?.id
                ? readBusy ? "상태 확인 중…" : "상태 확인 필요"
                : running
                ? `값 변환 중 · ${running.processed}/${running.total}`
                : row.version
                ? `버전 ${row.version.schema_version} · 적용됨`
                : rowJob?.status === "failed"
                ? "값 변환 실패"
                : c
                ? schemaChangeLabels[c.status]
                : rowJob
                ? migrationLabels[rowJob.status]
                : "";
              const title = row.version?.schema_version === 1 ? "최초 생성" : "입력 항목 변경";
              const toggleHistory = () => {
                        if (isOpen) {
                          setExpandedRow(undefined);
                          if (plan?.id === row.changeId) setReviewOpen(false);
                          if (isSelectedJob) setSelectedJobOpen(false);
                          if (
                            selectedVersion &&
                            selectedVersion.schema_version ===
                              row.version?.schema_version
                          ) {
                            const params = new URLSearchParams(location.search);
                            params.delete("schema_version");
                            navigate(`${location.pathname}?${params}`);
                          }
                          return;
                        }
                        setExpandedRow(row.id);
                        if (isSelectedJob) setSelectedJobOpen(true);
                        if (rowJob || row.version) {
                          navigate(materialSettingsPath(type.id, location.search, {
                            job_id: rowJob?.id ?? null,
                            schema_version: row.version ? String(row.version.schema_version) : null,
                          }));
                        }
                        if (row.changeId && c && !rowJob && !row.version) {
                          setReviewOpen(true);
                          const params = new URLSearchParams(location.search);
                          params.set("change_id", row.changeId);
                          params.delete("job_id");
                          navigate(
                            `/settings/entity-types/${type.id}?${params}`,
                          );
                          if (plan?.id !== row.changeId) {
                            void loadPlan(row.changeId);
                          }
                        }
              };
              const historyDisabled = !isOpen && plan?.id !== row.changeId && (busy || uncertain || readBusy || dirty);
              return (
                <CollectionItem key={row.id}>
                  <BusinessRow aria-label={`${title} ${new Date(row.createdAt).toLocaleString()}`} data-expanded={isOpen || undefined}>
                    <BusinessDisclosureCell><Button variant="ghost" size="icon" type="button" aria-label={`${title} ${new Date(row.createdAt).toLocaleString()} ${isOpen ? "접기" : "열기"}`} aria-expanded={isOpen} aria-controls={`schema-history-${row.id}`} disabled={historyDisabled} onClick={toggleHistory}>
                      {isOpen ? <ChevronDownIcon /> : <ChevronRightIcon />}
                    </Button></BusinessDisclosureCell>
                    <BusinessCell index={0}><h3><Button variant="link" type="button" className="h-auto min-h-[max(2.75rem,44px)] max-w-full justify-start px-0 text-left whitespace-normal wrap-anywhere"
                      aria-label={`${title} 시각 ${new Date(row.createdAt).toLocaleString()} 상태 ${status}`} aria-expanded={isOpen} aria-controls={`schema-history-${row.id}`} disabled={historyDisabled} onClick={toggleHistory}>
                      {title}
                    </Button></h3></BusinessCell>
                    <BusinessCell index={1}><time dateTime={row.createdAt}>{new Date(row.createdAt).toLocaleString()}</time></BusinessCell>
                    <BusinessCell index={2}>{status}</BusinessCell>
                  </BusinessRow>
                  <BusinessDetails hidden={!isOpen} role="region" aria-label={`${title} ${new Date(row.createdAt).toLocaleString()}`}>

                    <div
                      id={`schema-history-${row.id}`}
                      className="flex min-w-0 flex-col gap-4 pt-4"
                      hidden={!isOpen}
                    >
                      {row.version && (
                        <SchemaVersionRead
                          key={row.version.schema_version}
                          typeId={type.id}
                          version={row.version.schema_version}
                          open={isOpen}
                          onError={(message) =>
                            setVersionErrors((errors) => ({
                              ...errors,
                              [row.id]: message,
                            }))}
                        />
                      )}
                      {!row.version && plan && plan.id === row.changeId &&
                        !transforming && <SchemaDefinitionRead definition={plan.target} />}
                      {!row.version && jobs.selectedChange &&
                        jobs.selectedChange.id === row.changeId &&
                        (plan?.id !== row.changeId || transforming) &&
                        (
                          <SchemaChangeRead
                            change={jobs.selectedChange}
                            definition={definition}
                          />
                        )}
                      {row.jobs.length > 0 && (
                        <div className="flex flex-col gap-4">
                          {row.jobs.length > 1 && (
                            <nav aria-label="이 변경의 값 변환 이력">
                              <BusinessTable label="변경별 값 변환 실행 목록" columns={["실행 시각", "상태"]} disclosureColumn={false}>
                                {row.jobs.map(job => <BusinessRow key={job.id}>
                                  <BusinessCell index={0}><Button asChild variant="link" className="h-auto min-h-11 max-w-full justify-start px-0 text-left whitespace-normal wrap-anywhere"><Link
                                    to={materialSettingsPath(type.id, location.search, { job_id: job.id })}
                                    aria-label={`${new Date(job.created_at).toLocaleString()} · ${migrationLabels[job.status]}`}>
                                    <time dateTime={job.created_at}>{new Date(job.created_at).toLocaleString()}</time>
                                  </Link></Button></BusinessCell>
                                  <BusinessCell index={1}>{migrationLabels[job.status]}</BusinessCell>
                                </BusinessRow>)}
                              </BusinessTable>
                            </nav>
                          )}
                          {(isSelectedJob ||
                            (!selectedJob &&
                              (isOpen || plan?.id === row.changeId))) &&
                            rowJob && (
                            <SchemaMigrationJob
                              key={rowJob.id}
                              typeId={type.id}
                              jobId={rowJob.id}
                              onState={onJobState ?? noJobState}
                              onApplied={onMigrationApplied}
                              onJobChange={jobs.accept}
                              publicationError={jobErrors[rowJob.id] ?? ""}
                              disabled={jobDisabled}
                            />
                          )}
                        </div>
                      )}
                      {!row.version && plan && plan.id === row.changeId &&
                        !transforming && (
                        <section
                          className="min-w-0"
                          aria-label="입력 항목 변경 요약"
                          data-change-version={plan.version}
                        >
                          <h3 className="text-base font-semibold" ref={reviewHeading} tabIndex={-1}>변경 검토</h3>
                          {restartedFrom && (
                            <Alert role="status"><AlertDescription>최신 기준으로 만든 새 변경안입니다. 기존 변경안은 이력에 유지됩니다.</AlertDescription></Alert>
                          )}
                          <p>버전 {plan.source_schema_version} → {plan.source_schema_version + 1}</p>
                          {!["applied", "cancelled"].includes(plan.status) && (
                            <p>
                              아직 적용되지 않았습니다. 변경 내용과 기존 자료에 미치는 영향을 확인하세요.
                            </p>
                          )}
                          <Link
                            to={{
                              pathname: location.pathname,
                              search: (() => {
                                const params = new URLSearchParams(
                                  location.search,
                                );
                                params.set("change_id", plan.id);
                                return `?${params}`;
                              })(),
                            }}
                          >
                            이 변경안 직접 링크
                          </Link>
                          {plan.recovery && (
                            <section aria-label="복구안 원본">
                              <p>
                                보존 원본을 사용하는 새 버전의 복구안입니다. 영향 분석 후 현재 값 → 복구 값 미리보기를
                                확인하고 실행하세요.
                              </p>
                              <Link
                                to={materialSettingsPath(
                                  plan.type_id,
                                  location.search,
                                  {
                                    job_id: plan.recovery.source_job_id,
                                  },
                                )}
                              >
                                원본 작업 확인
                              </Link>
                              <p className="text-sm text-muted-foreground">
                                원본 보존 만료:{" "}
                                <time
                                  dateTime={plan.recovery.source_expires_at}
                                >
                                  {new Date(plan.recovery.source_expires_at)
                                    .toLocaleString()}
                                </time>
                              </p>
                              <p>
                                복구안의 입력 항목과 변환 규칙은 원본 기준으로 유지됩니다. 보완이 필요하면 현재 자료를
                                직접 수정하거나 새 변경안을 준비하고 다시 분석하세요.
                              </p>
                            </section>
                          )}
                          {planSyncNeeded && (
                            <Alert role="status"><AlertDescription>
                              {readBusy ? "최신 변경안 상태를 확인하는 중…" : "최신 변경안 상태를 다시 확인하세요."}
                            </AlertDescription></Alert>
                          )}
                          <SchemaChangeDiff
                            change={plan}
                            definition={definition}
                          />
                          {!planSyncNeeded && plan.analysis && plan.status !== "cancelled" && (
                            <Alert

                              role="status"
                            ><AlertDescription>
                              <strong>
                                {{
                                  queued: "검토 접수",
                                  running: "기존 자료 확인 중",
                                  succeeded: plan.analysis.failed ? "보완 필요" : "검토 완료",
                                  failed: "검토 실패",
                                }[plan.analysis.status]}
                              </strong>
                              <p>
                                확인한 자료 {plan.analysis.processed}/{plan.analysis
                                  .total}개 · 문제 {plan.analysis.failed}개
                              </p>
                              {dirty && (
                                <p className="text-sm text-destructive">
                                  검토 이후 입력이 바뀌었습니다. 변경 검토를 다시 진행하세요.
                                </p>
                              )}
                            </AlertDescription></Alert>
                          )}
                          {!planSyncNeeded && plan.analysis && plan.status !== "cancelled" && (
                            <Collapsible>
                              <CollapsibleTrigger asChild><Button type="button" variant="ghost" className="h-auto min-h-[max(2.75rem,44px)] w-full justify-start whitespace-normal text-left">자료별 결과</Button></CollapsibleTrigger><CollapsibleContent forceMount className="min-w-0 pt-3 data-[state=closed]:hidden">
                              <p>
                                변경 {plan.analysis.changed}개 · 무변경 {plan.analysis.unchanged}개 · 값 제거{" "}
                                {plan.analysis.removed}개 · 값 보완 {plan.analysis.replacements}개
                              </p>
                              <SchemaAnalysisErrors change={plan} definition={definition} />
                            </CollapsibleContent></Collapsible>
                          )}
                          {actions.conversionVisible
                            ? (
                              <ConversionEditor
                                key={plan.id}
                                plan={plan}
                                sourceDefinition={definition.schema_version === plan.source_schema_version
                                  ? definition
                                  : undefined}
                                migration={migration}
                                onChange={editor.editMigration}
                                disabled={!!row.version || editor.view.conversionDisabled}
                              />
                            )
                            : null}
                          {!planSyncNeeded && plan.analysis && plan.analysis.failed > 0 && (
                            <p>
                              실패한 자료 값을 확인하여 직접 수정하거나 값 변환 변경을 준비한 뒤 다시 분석하세요. 실패가
                              있으면 적용할 수 없습니다.
                            </p>
                          )}
                          {!row.version &&
                            plan.change_kind === "migration_required" && (
                            <p>
                              현재 자료와 활성 정의는 유지됩니다. 영향 분석 결과를 확인하고 값 변환 작업을 준비하세요.
                            </p>
                          )}
                          {!planSyncNeeded && plan.analysis?.status === "failed" &&
                            plan.status !== "cancelled" && (
                            <Alert variant="destructive" role="alert" className="text-sm text-destructive"><AlertDescription>
                              분석 작업 실패: {plan.analysis.failure_reason}. 원본은 유지됩니다. 다시 분석하세요.
                            </AlertDescription></Alert>
                          )}
                          {plan.status === "stale" && (
                            <p>
                              {plan.recovery
                                ? "정의나 자료·연결이 변경되었습니다. 입력은 유지됩니다. 현재 상태를 확인하고 보완한 뒤 새 변경안을 분석하세요."
                                : "정의나 자료가 변경되었습니다. 최신 정의를 확인하고 새 변경을 만드세요."}
                            </p>
                          )}
                          <div role="group" aria-label="변경안 동작" className="flex flex-wrap items-center justify-end gap-2">
                            {(row.version ||
                                ["applied", "cancelled"].includes(plan.status))
                              ? (
                                <>
                                  {plan.status === "applied" &&
                                    definition.schema_version <=
                                      plan.source_schema_version &&
                                    (
                                      <Button variant="outline"

                                        disabled={busy || uncertain || readBusy}
                                        onClick={() => void editor.refreshDefinition()}
                                      >
                                        최신 설정 다시 조회
                                      </Button>
                                    )}
                                </>
                              )
                              : (
                                <>
                                  <Button variant="destructive"

                                    disabled={actions.discard.disabled}
                                    onClick={() => setDiscardConfirm(true)}
                                  >
                                    폐기
                                  </Button>
                                  {primaryAction && (
                                    <Button variant="default"
                                      disabled={primaryAction.disabled}
                                      onClick={() => void primaryAction.run?.()}
                                    >
                                      {primaryAction.label ?? actionLabels[primaryAction.kind]}
                                    </Button>
                                  )}
                                  {primaryAction?.kind === "migration" && startError && (
                                    <Alert variant="destructive" role="alert" className="text-sm text-destructive"><AlertDescription>
                                      {startError} 작업 목록에서 접수 여부를 확인할 수 있습니다.
                                    </AlertDescription></Alert>
                                  )}
                                </>
                              )}
                          </div>
                        </section>
                      )}
                    </div>
                  </BusinessDetails>
                </CollectionItem>
              );
            })}
          </CollectionList>
          {historyRows.length === 0 && <p className="text-sm text-muted-foreground">변경 이력이 없습니다.</p>}
          {editor.view.changesBefore && (
            <Button variant="ghost" type="button"
              disabled={readBusy || busy || uncertain}
              onClick={() => void editor.moreChanges()}
            >
              이전 변경안 더 보기
            </Button>
          )}
          <Button variant="ghost" type="button"

            disabled={busy || readBusy || uncertain}
            onClick={() => {
              jobs.refresh();
              void editor.refreshChanges();
            }}
          ><RotateCcwIcon data-icon="inline-start" />
            변경 이력 다시 조회
          </Button>
          {jobs.error && <Alert variant="destructive" role="alert" className="text-sm text-destructive"><AlertDescription>{jobs.error}</AlertDescription></Alert>}
          {jobs.before && (
            <Button variant="ghost" type="button" disabled={jobs.moreBusy} onClick={() => void jobs.more()}>
              {jobs.moreBusy ? "이전 변환 이력 읽는 중…" : "이전 변환 이력 더 보기"}
            </Button>
          )}
          {jobs.error && (
            <Button variant="ghost" type="button"  onClick={jobs.refresh}><RotateCcwIcon data-icon="inline-start" />
              변환 이력 다시 조회
            </Button>
          )}
          {historyBefore !== null && (
            <Button variant="ghost" type="button"
              disabled={historyBusy}
              onClick={() => void onMoreVersions?.()}
            >
              {historyBusy ? "이전 버전 읽는 중…" : "이전 적용 버전 더 보기"}
            </Button>
          )}
        </div>
      </MaterialSettingsSection>
      <ConfirmDialog
        open={discardConfirm}
        title="변경안을 폐기할까요?"
        message="이 변경안은 다시 적용할 수 없습니다. 현재 자료와 적용된 설정은 유지되며 변경 이력은 남습니다."
        confirmLabel="폐기"
        danger
        confirmDisabled={actions.discard.disabled}
        onCancel={() => setDiscardConfirm(false)}
        onConfirm={() => {
          setDiscardConfirm(false);
          void actions.discard.run();
        }}
      />
      <ConfirmDialog
        open={deleteKey !== null}
        title="항목을 삭제할까요?"
        message={<><DataFields><div className="col-span-full"><dt>항목 이름</dt><dd>{deleteKey ? draft.schema.properties[deleteKey]?.title ?? "항목" : "항목"}</dd></div></DataFields><p>삭제하는 변경안을 만듭니다. 적용하면 현재 자료의 해당 값도 제거되며 과거 기록은 유지됩니다. 아직 실제 자료는 변경되지 않습니다.</p></>}
        confirmLabel="삭제 변경안 만들기"
        danger
        confirmDisabled={busy || uncertain || disabled || readBusy}
        onCancel={() => setDeleteKey(null)}
        onConfirm={() => {
          if (deleteKey) editor.removeField(deleteKey);
          setDeleteKey(null);
          requestAnimationFrame(() => propertiesHeading.current?.focus());
        }}
      />
    </div>
  );
}

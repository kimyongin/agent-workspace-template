import { effectiveEntityTitleTemplate, entityTitleTemplateIssues } from "@contracts/entity-title-template.ts";
import { useApi } from "../../lib/api-context.tsx";
import { schemaPresentation } from "../../lib/schema-document.ts";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { EntityField, EntitySchemaVersion, EntityType } from "@contracts/entity-type.ts";
import type {
  EntitySchemaChange,
  EntitySchemaChangeSummary,
  MigrationPlan,
  SchemaAnalysisAccepted,
  SchemaDefinition,
  SchemaEdit,
} from "@contracts/entity-schema-change.ts";
import { entityFieldInput } from "@contracts/entity-schema-change.ts";

import { useSettingsAccess } from "./workspace-settings-access.tsx";
import type { EntitySchemaMigration, SchemaMigrationAccepted } from "@contracts/entity-schema-migration.ts";
import { migrationActive } from "./schema-migration-status.ts";
import { ApiError } from "../../lib/api-error.ts";
import { useWriteAttempt, writeErrorMessage } from "../../lib/write-attempt.ts";
import { migrationNumericValues, SchemaNumericDraftError, schemaNumericValues } from "./numeric-drafts.ts";
import { recoveryErrorMessage } from "./SchemaRecovery.tsx";
import { fieldInputPolicy } from "./field-input-policy.ts";
import { fieldType } from "../entity/property-fields.tsx";
function supportsNumericCondition(field: EntityField, name: string) {
  const kind = fieldType(field);
  if (name === "minLength" || name === "maxLength") {
    return kind === "string" && !field.format;
  }
  if (name === "default" && (field.default === undefined || field.default === null)) return false;
  return kind === "number" || kind === "integer";
}
/** Optional false annotations and object key order have no document meaning. */
function draftFingerprint(value: unknown): string {
  const normalize = (item: unknown, key?: string): unknown => {
    if (Array.isArray(item)) return key === "required" ? [...item].sort() : item.map((value) => normalize(value));
    if (item && typeof item === "object") {
      return Object.fromEntries(
        Object.entries(item)
          .filter(([name, value]) =>
            value !== undefined &&
            !(value === false && ["deprecated", "readOnly", "x-search-text"].includes(name))
          )
          .sort(([a], [b]) => a.localeCompare(b)).map(([name, value]) => [name, normalize(value, name)]),
      );
    }
    return item;
  };
  return JSON.stringify(normalize(value));
}
const clone = (v: SchemaDefinition) => structuredClone({ schema: v.schema });
export type EditState = { dirty: boolean; busy: boolean; uncertain: boolean; error?: boolean };
type ReviewAction = {
  kind:
    | "sync-pending"
    | "sync-required"
    | "retry"
    | "restart"
    | "review"
    | "analyzing"
    | "analyze"
    | "reanalyze"
    | "migration"
    | "publish";
  disabled: boolean;
  label?: string;
  run?: () => void | Promise<void>;
};
/** Owns a material's schema-change editing intent, reads, and writes.
 * Published definitions come from the settings owner; rows and focus stay in the UI.
 */
export function useSchemaChangeEditor(
  { type, definition, onApplied, onState, disabled, selectionSearch, onFieldKeysChanged, onInvalidField, onReviewed, onNavigate, jobs }: {
    onNavigate: (path: string) => void;
    jobs: EntitySchemaMigration[];
    type: EntityType;
    definition: EntitySchemaVersion;
    onApplied: (change?: EntitySchemaChange) => Promise<string>;
    onState: (state: EditState) => void;
    disabled: boolean;
    selectionSearch: string;
    onFieldKeysChanged: (replacements: Record<string, string>) => void;
    onReviewed: () => void;
    onInvalidField: (key: string, includeSelect: boolean, condition?: string) => void;
  },
) {
  const api = useApi();
  const latestApi = useRef(api);
  latestApi.current = api;
  const { canWrite } = useSettingsAccess();
  // Receipt confirmation has its own frozen request, independent of saving a change.
  const { attempt: startAttempt, ...startState } = useWriteAttempt<SchemaMigrationAccepted>();
  const [startError, setStartError] = useState("");
  const lockedPlan = jobs.some((job) => migrationActive(job) &&
    job.change_id === new URLSearchParams(selectionSearch).get("change_id"));
  disabled = disabled || !canWrite || lockedPlan;
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [draft, setDraft] = useState<SchemaDefinition>(() => clone(definition)),
    [saved, setSaved] = useState<SchemaDefinition>(() => clone(definition));
  const [plan, setPlan] = useState<EntitySchemaChange | null>(null),
    [changes, setChanges] = useState<EntitySchemaChangeSummary[]>([]),
    [refs, setRefs] = useState<Record<string, string>>({});
  const changesExpanded = useRef(false);
  const [changesBefore, setChangesBefore] = useState<string | null>(null);
  const latestPlan = useRef(plan);
  latestPlan.current = plan;
  const [numericDrafts, setNumericDrafts] = useState<Record<string, string>>({});
  const deletedDrafts = useRef<Record<string, { field: EntityField; required: boolean; index: number }>>({});
  const [migration, setMigration] = useState<MigrationPlan>({ rules: [], overrides: [] });
  const [acceptedAnalysis, setAcceptedAnalysis] = useState<string | null>(null);
  const [restartedFrom, setRestartedFrom] = useState<string | null>(null);
  const [staleInput, setStaleInput] = useState(false);
  const [planSyncNeeded, setPlanSyncNeeded] = useState(false);
  const [reviewTarget, setReviewTarget] = useState<{ id: string; version: number } | null>(null);
  const [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [readBusy, setReadBusy] = useState(false);
  const { attempt, busy, uncertain } = useWriteAttempt();
  const mounted = useRef(true);
  const latestDefinition = useRef(definition);
  latestDefinition.current = definition;
  const seenDefinition = useRef({ typeId: type.id, version: definition.schema_version });
  const planRead = useRef<{ epoch: number; controller: AbortController | null }>({ epoch: 0, controller: null });
  const dirty = Object.keys(numericDrafts).length > 0 || draftFingerprint(draft) !== draftFingerprint(saved) ||
    draftFingerprint(migration) !== draftFingerprint(plan?.migration ?? { rules: [], overrides: [] });
  const protectedDraft = useRef({ dirty, busy, uncertain });
  protectedDraft.current = { dirty, busy: busy || startState.busy, uncertain: uncertain || startState.uncertain };
  const cancelPlanRead = () => {
    planRead.current.controller?.abort();
    planRead.current = { epoch: planRead.current.epoch + 1, controller: null };
  };
  const applyPlan = (value: EntitySchemaChange | null) => {
    deletedDrafts.current = {};
    const target = value?.target ?? latestDefinition.current;
    onFieldKeysChanged(
      Object.fromEntries(Object.entries(value?.reservations ?? {}).map(([ref, key]) => [`new_${ref}`, key])),
    );
    setFieldError(null);
    setPlan(value);
    setRestartedFrom(null);
    setStaleInput(false);
    setPlanSyncNeeded(false);
    setMigration(value?.migration ?? { rules: [], overrides: [] });
    setAcceptedAnalysis(null);
    setDraft(clone(target));
    setSaved(clone(target));
    setNumericDrafts({});
    setRefs(Object.fromEntries(Object.entries(value?.reservations ?? {}).map(([ref, key]) => [key, ref])));
  };
  useLayoutEffect(() => {
    onState({ dirty, busy: busy || startState.busy, uncertain: uncertain || startState.uncertain, error: !!error });
  }, [dirty, busy, uncertain, error, startState.busy, startState.uncertain, onState]);
  useLayoutEffect(() => () => onState({ dirty: false, busy: false, uncertain: false }), [onState]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      cancelPlanRead();
    };
  }, []);
  useEffect(() => {
    const prior = seenDefinition.current;
    if (prior.typeId === type.id && prior.version === definition.schema_version) return;
    // An unresolved request retains its exact payload until its result is confirmed.
    if (prior.typeId === type.id && (protectedDraft.current.busy || protectedDraft.current.uncertain)) return;
    seenDefinition.current = { typeId: type.id, version: definition.schema_version };
    cancelPlanRead();
    setReadBusy(false);
    if (prior.typeId !== type.id || !protectedDraft.current.dirty) {
      applyPlan(null);
      return;
    }
    const next = clone(definition);
    for (const key of new Set([...Object.keys(saved.schema.properties), ...Object.keys(draft.schema.properties)])) {
      const previousField = saved.schema.properties[key], localField = draft.schema.properties[key];
      if (draftFingerprint(previousField) !== draftFingerprint(localField)) {
        if (!localField) {
          delete next.schema.properties[key];
        } else if (!previousField || !next.schema.properties[key]) {
          next.schema.properties[key] = structuredClone(localField);
        } else {
          // Carry local attribute edits, while keeping the worker's published type/conditions.
          const field = { ...next.schema.properties[key] };
          for (const name of new Set([...Object.keys(previousField), ...Object.keys(localField)])) {
            const attribute = name as keyof EntityField;
            if (draftFingerprint(previousField[attribute]) !== draftFingerprint(localField[attribute])) {
              Object.assign(field, { [attribute]: localField[attribute] });
            }
          }
          next.schema.properties[key] = field;
        }
      }
      const previous = saved.schema.required.includes(key), local = draft.schema.required.includes(key);
      if (!next.schema.properties[key]) next.schema.required = next.schema.required.filter((value) => value !== key);
      else if (previous !== local) {
        next.schema.required = [...next.schema.required.filter((value) => value !== key), ...(local ? [key] : [])];
      }
    }
    if (effectiveEntityTitleTemplate(draft.schema) !== effectiveEntityTitleTemplate(saved.schema)) {
      next.schema["x-title-template"] = effectiveEntityTitleTemplate(draft.schema);
    }
    const migrationEdited =
      draftFingerprint(migration) !== draftFingerprint(plan?.migration ?? { rules: [], overrides: [] });
    setPlan(null);
    setAcceptedAnalysis(null);
    setDraft(next);
    setSaved(clone(definition));
    setRefs((values) => Object.fromEntries(Object.entries(values).filter(([key]) => key.startsWith("new_"))));
    if (!migrationEdited) setMigration({ rules: [], overrides: [] });
    setMessage("현재 적용된 입력 항목을 갱신했습니다. 편집 중인 입력은 유지됩니다. 변경된 조건을 확인하고 다시 검토하세요.");
  }, [type.id, definition.schema_version, busy, uncertain, startState.busy, startState.uncertain]);
  const base = `/entity-types/${type.id}/schema-changes`;
  const list = (signal?: AbortSignal) =>
    api<{ items: EntitySchemaChangeSummary[]; next_before?: string | null }>("GET", base, undefined, signal).then(
      (r) => {
        if (mounted.current && !signal?.aborted) {
          const selected = latestPlan.current;
          setChanges((prior) => {
            const incoming = selected && !r.items.some((item) => item.id === selected.id)
              ? [selected, ...r.items]
              : r.items;
            const known = new Map(prior.filter((item) => item.type_id === type.id).map((item) => [item.id, item]));
            for (const item of incoming) {
              const previous = known.get(item.id);
              if (
                !previous || item.version > previous.version ||
                (item.version === previous.version && item.updated_at >= previous.updated_at)
              ) known.set(item.id, item);
            }
            return [...known.values()].sort((a, b) => b.id.localeCompare(a.id));
          });
          if (!changesExpanded.current) {
            setChangesBefore(r.next_before ?? null);
          }
        }
      },
    );
  useEffect(() => {
    changesExpanded.current = false;
  }, [type.id]);
  useEffect(() => {
    const controller = new AbortController();
    void list(controller.signal).catch((e) => {
      if (!controller.signal.aborted && mounted.current) setError(e.message);
    });
    return () => controller.abort();
  }, [type.id, definition.schema_version]);
  useEffect(() => {
    if (!plan || (plan.status !== "analyzing" && !acceptedAnalysis)) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const value = await api<EntitySchemaChange>("GET", `${base}/${plan.id}`, undefined, controller.signal);
        if (!controller.signal.aborted) {
          setPlan(value);
          if (value.status !== "analyzing") setAcceptedAnalysis(null);
          if (value.status === "analyzing") {
            timer = setTimeout(() => void poll(), 1200);
          }
        }
      } catch (e) {
        if (!controller.signal.aborted) {
          setError(e instanceof Error ? e.message : "분석 상태 조회 실패");
          timer = setTimeout(() => void poll(), 1200);
        }
      }
    };
    timer = setTimeout(() => void poll(), 1200);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [plan?.id, plan?.status, acceptedAnalysis]);
  useEffect(() => {
    if (plan) {
      setChanges((items) =>
        items.some((item) => item.id === plan.id)
          ? items.map((item) => item.id === plan.id ? plan : item)
          : [plan, ...items]
      );
    }
  }, [plan]);
  const setField = (key: string, field: EntityField) =>
    setDraft((d) => ({ ...d, schema: { ...d.schema, properties: { ...d.schema.properties, [key]: field } } }));
  const setNumericField = (
    key: string,
    name: "minLength" | "maxLength" | "minimum" | "maximum" | "multipleOf" | "default",
    raw: string,
  ) => {
    setNumericDrafts((values) => ({ ...values, [key + ":" + name]: raw }));
  };
  const flag = (key: string, name: "required" | "archived", value: boolean) =>
    setDraft((d) => {
      if (name === "required") {
        return {
          ...d,
          schema: {
            ...d.schema,
            properties: {
              ...d.schema.properties,
              [key]: fieldInputPolicy(d.schema.properties[key], value),
            },
            required: value
              ? [...d.schema.required.filter((k) => k !== key), key]
              : d.schema.required.filter((k) => k !== key),
          },
        };
      }
      return {
        ...d,
        schema: {
          ...d.schema,
          properties: {
            ...d.schema.properties,
            [key]: {
              ...d.schema.properties[key],
              deprecated: value,
              ...(name === "archived" && value ? { "x-search-text": false } : {}),
            },
          },
        },
      };
    });
  const edits = (draft: SchemaDefinition): SchemaEdit[] => {
    const result: SchemaEdit[] = [];
    if (effectiveEntityTitleTemplate(draft.schema) !== effectiveEntityTitleTemplate(definition.schema)) {
      result.push({ op: "set_metadata", "x-title-template": effectiveEntityTitleTemplate(draft.schema) });
    }
    for (const [key, field] of Object.entries(draft.schema.properties)) {
      const required = draft.schema.required.includes(key);
      if (refs[key]) {
        result.push({ op: "add_property", client_ref: refs[key], field, required });
      } else if (
        draftFingerprint(field) !== draftFingerprint(definition.schema.properties[key]) ||
        required !== definition.schema.required.includes(key)
      ) result.push({ op: "update_property", key, field, required });
    }
    for (const key of Object.keys(definition.schema.properties)) {
      if (!draft.schema.properties[key]) {
        result.push({ op: "remove_property", key });
      }
    }
    return result;
  };
  const validateFields = () => {
    const titleIssues = entityTitleTemplateIssues(effectiveEntityTitleTemplate(draft.schema), draft.schema);
    if (titleIssues.length) {
      setError(titleIssues.map((issue) => issue.reason).join(" · "));
      return false;
    }
    for (const key of schemaPresentation(draft).order) {
      let condition: string | undefined;
      try {
        if (
          Object.keys(numericDrafts).some((address) =>
            address.startsWith(key + ":") &&
            !supportsNumericCondition(draft.schema.properties[key], address.split(":")[1])
          )
        ) {
          throw new Error(
            "현재 타입에서 사용할 수 없는 이전 조건 입력이 있습니다. 해당 입력 항목에서 입력을 확인하고 제거하세요.",
          );
        }
        const converted = schemaNumericValues(
          draft,
          Object.fromEntries(
            Object.entries(numericDrafts).filter(([address]) => address.startsWith(key + ":")),
          ),
        );
        const field = converted.schema.properties[key];
        const valid = entityFieldInput.safeParse(field);
        if (!valid.success) {
          condition = String(valid.error.issues[0].path[0]);
          throw new Error("입력 항목 조건을 확인하세요.");
        }
        if (
          (field.minLength ?? 0) > (field.maxLength ?? 4096) ||
          field.minimum !== undefined && field.maximum !== undefined && field.minimum > field.maximum
        ) {
          condition = (field.minLength ?? 0) > (field.maxLength ?? 4096) ? "maxLength" : "maximum";
          throw new Error("최소 조건이 최대 조건보다 큽니다.");
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "입력 항목 조건을 확인하세요.");
        setFieldError(key);
        onInvalidField(key, true, e instanceof SchemaNumericDraftError ? e.condition : condition);
        return false;
      }
    }
    setFieldError(null);
    setError("");
    return true;
  };
  const migrationInput = () => {
    const value = migrationNumericValues(plan?.target ?? draft, migration);
    const reference = (key: string) => refs[key] ? `new_${refs[key]}` : key;
    return {
      rules: value.rules.map((rule) => ({ ...rule, key: reference(rule.key) })),
      overrides: value.overrides.map((override) => ({ ...override, key: reference(override.key) })),
    };
  };
  const write = async (action: "save" | "restart" | "analyze" | "apply" | "discard") => {
    if (busy || disabled) return;
    setError("");
    setMessage("");
    let payload;
    try {
      payload = action === "save" || action === "restart"
        ? {
          expected_schema_version: definition.schema_version,
          edits: edits(schemaNumericValues(draft, numericDrafts)),
          migration: migrationInput(),
          ...(plan && action !== "restart" ? { expected_change_version: plan.version } : {}),
        }
        : action === "apply"
        ? { expected_change_version: plan!.version, analysis_id: plan!.analysis!.id }
        : { expected_change_version: plan!.version };
    } catch (e) {
      setError(e instanceof Error ? e.message : "숫자를 확인하세요.");
      return;
    }
    const path = action === "restart"
      ? base
      : action === "save"
      ? (plan ? `${base}/${plan.id}` : base)
      : `${base}/${plan!.id}/${action}`;
    try {
      await attempt.run(async () => {
        if (action === "analyze") {
          const accepted = await api<SchemaAnalysisAccepted>("POST", path, payload, undefined, attempt.requestKey());
          if (mounted.current) {
            setAcceptedAnalysis(accepted.analysis_id);
            setMessage("영향 분석을 접수했습니다.");
          }
          return;
        }
        const value = await api<EntitySchemaChange>(
          action === "save" && plan ? "PATCH" : "POST",
          path,
          payload,
          undefined,
          attempt.requestKey(),
        );
        if (!mounted.current) return;
        cancelPlanRead();
        setReadBusy(false);
        if (action === "save" || action === "restart") {
          applyPlan(value);
          if (action === "restart") setRestartedFrom(plan!.id);
          setReviewTarget({ id: value.id, version: value.version });
          setMessage(
            action === "restart"
              ? "최신 기준으로 새 변경안을 만들었습니다. 기존 변경안은 이력에 유지됩니다."
              : "변경안을 저장했습니다. 자료에 미치는 영향을 확인합니다.",
          );
          onReviewed();
        } else if (action === "discard") {
          applyPlan(value);
          setMessage("변경안을 폐기했습니다. 현재 자료와 설정은 유지됩니다.");
        } else {
          setPlan(value);
          setMigration(value.migration);
          setMessage("새 입력 항목 버전을 적용했습니다.");
          const publicationError = await onApplied(value);
          if (mounted.current && publicationError) setError(publicationError);
        }
      });
    } catch (e) {
      if (mounted.current) {
        setError(plan?.recovery ? recoveryErrorMessage(e) : writeErrorMessage(e));
        if (e instanceof ApiError) {
          if (e.code === "schema_plan_stale") setStaleInput(true);
          const field = e.fields.map(({ path }) => {
            const named = path.match(/(?:^|\.)(prop_[0-9]+)(?:\.|$)/)?.[1];
            if (named) return named;
            const index = path.match(/^edits\.(\d+)/)?.[1];
            const edit = index ? edits(schemaNumericValues(draft, numericDrafts))[Number(index)] : undefined;
            return edit && "key" in edit
              ? edit.key
              : edit && "client_ref" in edit
              ? Object.keys(refs).find((key) => refs[key] === edit.client_ref)
              : undefined;
          }).find((key) => key && draft.schema.properties[key]);
          if (field) {
            setFieldError(field);
            const condition = e.fields.find((issue) => issue.path.split(".").includes(field))?.path.split(".").at(-1);
            onInvalidField(field, false, condition);
          }
        }
      }
    }
  };
  // Only an explicitly saved review starts analysis; reads and direct links never write.
  useEffect(() => {
    if (!reviewTarget || busy || uncertain) return;
    setReviewTarget(null);
    if (dirty || !plan || plan.id !== reviewTarget.id || plan.version !== reviewTarget.version) return;
    if (!["analyzing", "applied", "cancelled", "stale"].includes(plan.status)) {
      void write("analyze");
    }
  }, [reviewTarget, busy, uncertain, dirty, plan?.id, plan?.version]);
  const refreshPlan = async () => {
    const selected = latestPlan.current;
    if (!selected) return;
    cancelPlanRead();
    const controller = new AbortController(), epoch = planRead.current.epoch;
    planRead.current.controller = controller;
    const current = () =>
      mounted.current && !controller.signal.aborted && epoch === planRead.current.epoch &&
      latestPlan.current?.id === selected.id;
    setPlanSyncNeeded(true);
    setReadBusy(true);
    try {
      const fresh = await api<EntitySchemaChange>("GET", `${base}/${selected.id}`, undefined, controller.signal);
      if (!current()) return;
      if (protectedDraft.current.dirty || protectedDraft.current.busy || protectedDraft.current.uncertain) {
        setPlan(fresh);
        setAcceptedAnalysis(null);
      } else applyPlan(fresh);
      setPlanSyncNeeded(false);
      setError("");
    } catch (e) {
      if (current()) setError(e instanceof Error ? e.message : "변경안 상태를 다시 조회하세요.");
    } finally {
      if (current()) {
        planRead.current.controller = null;
        setReadBusy(false);
      }
    }
  };
  const refreshedJobs = useRef(new Set<string>());
  useEffect(() => {
    if (!plan) return;
    const terminal = jobs.find((job) => job.type_id === type.id && job.change_id === plan.id &&
      !migrationActive(job) && !refreshedJobs.current.has(`${job.id}:${job.version}`));
    if (!terminal) return;
    refreshedJobs.current.add(`${terminal.id}:${terminal.version}`);
    void refreshPlan();
  }, [jobs, plan?.id, type.id]);
  const loadPlan = async (id: string) => {
    if (protectedDraft.current.dirty || protectedDraft.current.busy || protectedDraft.current.uncertain) {
      setReadBusy(false);
      setMessage("현재 입력 항목은 유지됩니다. 편집을 검토·저장하거나 취소한 뒤 다른 변경안을 여세요.");
      return;
    }
    cancelPlanRead();
    const controller = new AbortController(), epoch = planRead.current.epoch;
    planRead.current.controller = controller;
    const current = () => mounted.current && !controller.signal.aborted && epoch === planRead.current.epoch;
    setReadBusy(true);
    setError("");
    try {
      const fresh = await api<EntitySchemaChange>("GET", `${base}/${id}`, undefined, controller.signal);
      if (
        current() && !protectedDraft.current.dirty && !protectedDraft.current.busy && !protectedDraft.current.uncertain
      ) {
        applyPlan(fresh);
      }
    } catch (e) {
      if (current()) setError(e instanceof Error ? e.message : "조회 실패");
    } finally {
      if (current()) {
        planRead.current.controller = null;
        setReadBusy(false);
      }
    }
  };
  useEffect(() => {
    const selected = new URLSearchParams(selectionSearch).get("change_id");
    if (selected && selected !== plan?.id) void loadPlan(selected);
    else setReadBusy(false);
    return cancelPlanRead;
  }, [selectionSearch, type.id, definition.schema_version]);
  const reorder = (key: string, offset: number) =>
    setDraft((d) => {
      const order = [...schemaPresentation(d).order], at = order.indexOf(key), other = at + offset;
      if (other < 0 || other >= order.length) return d;
      [order[at], order[other]] = [order[other], order[at]];
      return {
        ...d,
        schema: {
          ...d.schema,
          properties: Object.fromEntries(
            Object.entries(d.schema.properties)
              .map(([name, field]) => [name, { ...field, "x-order": (order.indexOf(name) + 1) * 10 }]),
          ),
        },
      };
    });

  const editable = () => !busy && !uncertain && !disabled && !readBusy && !startState.busy && !startState.uncertain;
  // Action policy is shared by the displayed affordance and its execution guard.
  // Field editing and conversion input retain their separate lifetime rules.
  const actionReady = editable() && !planSyncNeeded;
  const canRetry = !busy && !disabled && !planSyncNeeded;
  const canReview = uncertain ? canRetry : actionReady;
  const reviewSaved = plan?.status === "invalid" && plan.analysis?.status === "succeeded";
  const reviewDisabled = !canReview || !!plan?.recovery || (!dirty && !uncertain && !reviewSaved);
  const emptyPublication = !!plan && !plan.recovery && plan.analysis?.status === "succeeded" &&
    plan.analysis.total === 0;
  const canAnalyze = actionReady && !dirty && !!plan &&
    !["analyzing", "applied", "cancelled", "stale"].includes(plan.status);
  const canPublish = actionReady && !dirty && plan?.status === "ready" &&
    (plan.change_kind === "compatible" || emptyPublication) && plan.analysis?.failed === 0;
  const canRestart = actionReady && !plan?.recovery;
  const canDiscard = actionReady && !dirty && !!plan && !["applied", "cancelled"].includes(plan.status);
  const editField = (key: string, field: EntityField) => {
    if (editable() && !plan?.recovery) setField(key, field);
  };
  const editNumeric = (
    key: string,
    name: "minLength" | "maxLength" | "minimum" | "maximum" | "multipleOf" | "default",
    raw: string,
  ) => {
    if (editable() && !plan?.recovery) setNumericField(key, name, raw);
  };
  const removeNumericInput = (address: string) => {
    if (!editable() || plan?.recovery) return;
    setNumericDrafts((prior) => {
      const values = { ...prior };
      delete values[address];
      return values;
    });
  };
  const editFlag = (key: string, name: "required" | "archived", value: boolean) => {
    if (editable() && !plan?.recovery) flag(key, name, value);
  };
  const setFieldInactive = (key: string, value: boolean) => {
    if (
      !editable() || plan?.recovery
    ) return;
    if (value) {
      flag(key, "required", false);
    }
    flag(key, "archived", value);
  };
  const editOptionLabel = (key: string, code: string, label: string) => {
    if (!editable() || plan?.recovery) return;
    setDraft((d) => ({
      ...d,
      schema: {
        ...d.schema,
        properties: {
          ...d.schema.properties,
          [key]: {
            ...d.schema.properties[key],
            oneOf: d.schema.properties[key].oneOf?.map((option) =>
              option.const === code ? { ...option, title: label } : option
            ),
          },
        },
      },
    }));
  };
  const removeField = (key: string) => {
    if (!editable() || plan?.recovery) return;
    if (definition.schema.properties[key] && draft.schema.properties[key]) {
      deletedDrafts.current[key] = { field: structuredClone(draft.schema.properties[key]), required: draft.schema.required.includes(key), index: fieldOrder.indexOf(key) };
    }
    setDraft((d) => {
      const properties = { ...d.schema.properties };
      delete properties[key];
      return {
        ...d,
        schema: { ...d.schema, properties, required: d.schema.required.filter((k) => k !== key) },
      };
    });
  };
  const restoreField = (key: string) => {
    if (!editable() || plan?.recovery || !definition.schema.properties[key] || draft.schema.properties[key] || Object.keys(draft.schema.properties).length >= 64) return;
    const removed = deletedDrafts.current[key] ?? { field: definition.schema.properties[key], required: definition.schema.required.includes(key), index: schemaPresentation(definition).order.indexOf(key) };
    setDraft(d => {
      const order = fieldOrder.filter(name => name === key || d.schema.properties[name]);
      const restored = structuredClone(removed.field);
      const properties = { ...d.schema.properties, [key]: restored };
      return { ...d, schema: { ...d.schema,
        properties: Object.fromEntries(order.map(name => [name, { ...properties[name], "x-order": (fieldOrder.indexOf(name) + 1) * 10 }])),
        required: removed.required ? [...d.schema.required, key] : d.schema.required,
      } };
    });
    delete deletedDrafts.current[key];
  };
  const addField = () => {
    if (!editable() || plan?.recovery || Object.keys(draft.schema.properties).length >= 64) return;
    const ref = crypto.randomUUID(), key = `new_${ref}`;
    setRefs((r) => ({ ...r, [key]: ref }));
    setDraft((d) => ({
      ...d,
      schema: {
        ...d.schema,
        properties: {
          ...d.schema.properties,
          [key]: fieldInputPolicy({
            type: "string",
            title: "새 항목",
            "x-order": Math.max(0, ...Object.values(d.schema.properties).map((f) => f["x-order"])) + 10,
          }, false),
        },
      },
    }));
    return key;
  };
  const cancelEditing = () => {
    if (busy || uncertain || plan?.recovery) return;
    deletedDrafts.current = {};
    setDraft(clone(saved));
    setNumericDrafts({});
    setMigration(plan?.migration ?? { rules: [], overrides: [] });
    setError("");
  };
  const conversionDisabled = busy || uncertain || disabled || startState.busy || startState.uncertain ||
    !!plan?.recovery || !!plan && ["applied", "cancelled", "stale"].includes(plan.status);
  const editMigration = (value: MigrationPlan) => {
    // Conversion input can still be edited while a plan read is in flight.
    if (!conversionDisabled) {
      setMigration(value);
    }
  };
  const review = () => {
    if (!canReview) return;
    if (!uncertain && !dirty && plan) return analyze();
    if (uncertain || validateFields()) return write("save");
    return Promise.resolve();
  };
  const analyze = () => {
    if (canAnalyze) {
      return write("analyze");
    }
  };
  const publish = () => {
    if (canPublish) return write("apply");
  };
  const restartReview = () => {
    if (canRestart && validateFields()) return write("restart");
  };
  const discard = () => {
    if (canDiscard) return write("discard");
  };
  const startNewChange = () => {
    if (busy || uncertain || dirty || disabled || readBusy) return;
    cancelPlanRead();
    setReadBusy(false);
    applyPlan(null);
  };
  const refreshDefinition = async () => {
    setReadBusy(true);
    try {
      const failure = await onApplied();
      if (!mounted.current) return false;
      if (failure) {
        setError(failure);
        return false;
      }
      setError("");
      return true;
    } catch (e) {
      if (mounted.current) {
        setError(e instanceof Error ? e.message : "조회 실패");
      }
      return false;
    } finally {
      if (mounted.current) setReadBusy(false);
    }
  };
  const refreshChanges = async () => {
    setReadBusy(true);
    try {
      await list();
      await refreshPlan();
    } catch (e) {
      if (mounted.current) {
        setError(e instanceof Error ? e.message : "조회 실패");
      }
    } finally {
      if (mounted.current) setReadBusy(false);
    }
  };
  const moreChanges = async () => {
    if (!changesBefore || readBusy) return;
    setReadBusy(true);
    try {
      const result = await api<{ items: EntitySchemaChangeSummary[]; next_before: string | null }>(
        "GET",
        `${base}?before=${encodeURIComponent(changesBefore)}`,
      );
      if (mounted.current) {
        setChanges((prior) => [...prior, ...result.items.filter((item) => !prior.some((p) => p.id === item.id))]);
        changesExpanded.current = true;
        setChangesBefore(result.next_before);
        setError("");
      }
    } catch (error) {
      if (mounted.current) setError(writeErrorMessage(error));
    } finally {
      if (mounted.current) setReadBusy(false);
    }
  };
  const changedFields = schemaPresentation(draft).order.filter((key) =>
    draftFingerprint(draft.schema.properties[key]) !== draftFingerprint(saved.schema.properties[key]) ||
    draft.schema.required.includes(key) !== saved.schema.required.includes(key) ||
    Object.keys(numericDrafts).some((address) => address.startsWith(key + ":"))
  );
  // Saving/analyzing a plan does not publish it. Keep pending state separate from dirty tracking.
  const pending = !plan || !["applied", "cancelled", "stale"].includes(plan.status);
  const fieldStates = Object.fromEntries(schemaPresentation(draft).order.map(key => [key,
    pending && !definition.schema.properties[key] ? "추가 예정" :
    pending && (draftFingerprint(draft.schema.properties[key]) !== draftFingerprint(definition.schema.properties[key]) ||
      draft.schema.required.includes(key) !== definition.schema.required.includes(key)) ? "수정 예정" :
    changedFields.includes(key) ? "수정 중" : null,
  ]));
  const removedFields = pending ? schemaPresentation(definition).order.filter(key => !draft.schema.properties[key]).map(key => ({ key, field: deletedDrafts.current[key]?.field ?? definition.schema.properties[key], index: deletedDrafts.current[key]?.index ?? schemaPresentation(definition).order.indexOf(key) })) : [];
  const fieldOrder = [...schemaPresentation(draft).order];
  for (const removed of [...removedFields].sort((a, b) => a.index - b.index)) fieldOrder.splice(Math.min(removed.index, fieldOrder.length), 0, removed.key);
  const changeCount = changedFields.length +
    (effectiveEntityTitleTemplate(draft.schema) !== effectiveEntityTitleTemplate(saved.schema) ? 1 : 0) +
    Object.keys(saved.schema.properties).filter((key) => !draft.schema.properties[key]).length +
    (draftFingerprint(migration) !== draftFingerprint(plan?.migration ?? { rules: [], overrides: [] }) ? 1 : 0);
  const startMigration = async () => {
    if (!plan || !canWrite || startState.busy || (!startState.uncertain && (!actionReady || !plan.executable))) return;
    setStartError("");
    const requestApi = api;
    try {
      const accepted = await startAttempt.run(() => api<SchemaMigrationAccepted>(
        "POST", `${base}/${plan.id}/migrations`, {
          expected_change_version: plan.version,
          expected_schema_version: plan.source_schema_version,
          analysis_id: plan.analysis!.id,
          fingerprint: plan.fingerprint,
        }, undefined, startAttempt.requestKey(),
      ));
      if (!accepted || !mounted.current) return;
      const params = new URLSearchParams(selectionSearch);
      params.set("job_id", accepted.job_id);
      params.set("change_id", plan.id);
      requestAnimationFrame(() => {
        if (mounted.current && latestApi.current === requestApi) onNavigate(`/settings/entity-types/${plan.type_id}?${params}`);
      });
    } catch (e) {
      if (mounted.current) setStartError(plan.recovery ? recoveryErrorMessage(e) : writeErrorMessage(e));
    }
  };
  const historyAction = (): ReviewAction | null => {
    if (!plan || ["applied", "cancelled"].includes(plan.status)) return null;
    if (planSyncNeeded) return { kind: readBusy ? "sync-pending" : "sync-required", disabled: true };
    if (uncertain) return { kind: "retry", disabled: !canRetry, run: review };
    if ((staleInput || plan.status === "stale") && !plan.recovery) {
      return { kind: "restart", disabled: !canRestart, run: restartReview };
    }
    if (dirty) return { kind: "review", disabled: !canReview, run: review };
    if (acceptedAnalysis !== null || plan.status === "analyzing") return { kind: "analyzing", disabled: true };
    if (
      !["analyzing", "applied", "cancelled", "stale"].includes(plan.status) &&
      (!plan.analysis || plan.analysis.status === "failed")
    ) {
      return { kind: plan.analysis ? "reanalyze" : "analyze", disabled: !canAnalyze, run: analyze };
    }
    if (plan.change_kind === "migration_required" && !emptyPublication && plan.executable) {
      return {
        kind: "migration",
        disabled: startState.busy || !canWrite || (!startState.uncertain && (!actionReady || !plan.executable)),
        run: startMigration,
        label: startState.busy ? "접수 중…" : startState.uncertain ? "같은 접수 요청 다시 확인" : "값 변환 시작",
      };
    }
    if ((plan.change_kind === "compatible" || emptyPublication) && plan.status !== "stale") {
      return { kind: "publish", disabled: !canPublish, run: publish };
    }
    return null;
  };
  return {
    view: {
      draft,
      changedFields,
      fieldStates,
      removedFields,
      fieldOrder,
      changeCount,
      unsupportedNumericInputs: Object.entries(numericDrafts).filter(([address]) => {
        const [key, name] = address.split(":");
        return draft.schema.properties[key] && !supportsNumericCondition(draft.schema.properties[key], name);
      }),
      plan,
      changes,
      changesBefore,
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
      inputsDisabled: !editable(),
      conversionDisabled,
      restartedFrom,
      planSyncNeeded,
      migrationEdited:
        draftFingerprint(migration) !== draftFingerprint(plan?.migration ?? { rules: [], overrides: [] }),
    },
    editTitleTemplate: (value: string) => {
      if (editable() && !plan?.recovery) setDraft((draft) => ({ ...draft, schema: { ...draft.schema, "x-title-template": value } }));
    },
    editField,
    editNumeric,
    removeNumericInput,
    editFlag,
    setFieldInactive,
    editOptionLabel,
    removeField,
    restoreField,
    addField,
    cancelEditing,
    editMigration,
    moveField: (key: string, offset: number) => {
      if (editable() && !plan?.recovery) reorder(key, offset);
    },
    validateFields,
    actions: {
      review: {
        visible: !plan?.recovery && (!plan || dirty || reviewSaved),
        disabled: reviewDisabled,
        run: () => { if (!reviewDisabled) return review(); },
      },
      history: historyAction(),
      discard: { disabled: !canDiscard, run: discard },
      conversionVisible: !!plan && !planSyncNeeded && !emptyPublication &&
        (plan.change_kind === "migration_required" || !!plan.recovery || migration.rules.length > 0 ||
          migration.overrides.length > 0 || (plan.analysis?.failed ?? 0) > 0),
    },
    startNewChange,
    loadPlan,
    refreshDefinition,
    refreshPlan,
    refreshChanges,
    moreChanges,
  };
}

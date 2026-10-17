import type { EntitySchemaVersion, EntitySchemaVersionSummary, EntityType } from "@contracts/entity-type.ts";
import type { EntitySchemaChange } from "@contracts/entity-schema-change.ts";
import type { EntitySchemaMigration } from "@contracts/entity-schema-migration.ts";
import { api } from "../../lib/api.ts";

type HistoryPage = { items: EntitySchemaVersionSummary[]; next_before: number | null };
type Publication = { error: string; confirmed: boolean; pending: Promise<string> | null };

/** Confirmed facts and basic input belong to one fixed material-type route lifetime. */
export function createMaterialDefinition(typeId?: string) {
  let alive = true;
  const requests = new Set<AbortController>();
  const listeners = new Set<() => void>();
  const changes = new Map<string, Publication>();
  const jobs = new Map<string, Publication>();
  let historyGeneration = 0;
  let selectedJob: string | undefined;
  let publishedChange: string | undefined;
  let historyPending: AbortController | null = null;
  let latestPending: AbortController | null = null;
  let state = {
    type: null as EntityType | null,
    schema: null as EntitySchemaVersion | null,
    history: [] as EntitySchemaVersionSummary[],
    historyBefore: null as number | null,
    historyBusy: false,
    label: "",
    icon: "box",
    archived: false,
    basicConflict: false,
    latestBasics: null as EntityType | null,
    latestBusy: false,
    jobErrors: {} as Record<string, string>,
    dirty: false,
  };
  const emit = () => {
    state = {
      ...state,
      dirty: !!state.type &&
        (state.label !== state.type.label || state.icon !== state.type.icon_id ||
          state.archived !== state.type.archived),
    };
    for (const listener of listeners) listener();
  };
  const admitType = (saved: EntityType, preserveDraft: boolean) => {
    const previous = state.type;
    if (previous && saved.schema_version < previous.schema_version) return previous;
    state = {
      ...state,
      type: saved,
      label: preserveDraft && previous && state.label !== previous.label ? state.label : saved.label,
      icon: preserveDraft && previous && state.icon !== previous.icon_id ? state.icon : saved.icon_id,
      archived: preserveDraft && previous && state.archived !== previous.archived ? state.archived : saved.archived,
    };
    return saved;
  };
  const refresh = async (signal?: AbortSignal, preserveBasics = true) => {
    if (!typeId) return;
    const controller = new AbortController();
    requests.add(controller);
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) controller.abort();
    try {
      const [saved, definition, head] = await Promise.all([
        api<EntityType>("GET", `/entity-types/${typeId}`, undefined, controller.signal),
        api<EntitySchemaVersion>("GET", `/entity-types/${typeId}/schema`, undefined, controller.signal),
        api<HistoryPage>("GET", `/entity-types/${typeId}/schemas`, undefined, controller.signal),
      ]);
      controller.signal.throwIfAborted();
      if (!alive) return;
      admitType(saved, preserveBasics);
      if (
        definition.schema_version >= (state.schema?.schema_version ?? 0) &&
        definition.schema_version >= (state.type?.schema_version ?? 0)
      ) {
        // A refreshed head invalidates an in-flight page's cursor, not confirmed metadata.
        historyGeneration++;
        historyPending?.abort();
        historyPending = null;
        state = {
          ...state,
          schema: definition,
          history: head.items,
          historyBefore: head.next_before ?? null,
          historyBusy: false,
        };
      }
      emit();
    } finally {
      requests.delete(controller);
      signal?.removeEventListener("abort", abort);
    }
  };
  const publication = async (kind: "change" | "job", id: string) => {
    const outcomes = kind === "change" ? changes : jobs;
    const previous = outcomes.get(id);
    if (previous?.confirmed) return "";
    if (previous?.pending) return previous.pending;
    const outcome: Publication = { error: previous?.error ?? "", confirmed: false, pending: null };
    outcomes.set(id, outcome);
    outcome.pending = (async () => {
      try {
        await refresh();
        if (!alive) return "";
        outcome.confirmed = true;
        outcome.error = "";
      } catch {
        if (!alive) return "";
        outcome.error = kind === "change"
          ? "적용이 완료되었습니다. 최신 정의 조회에 실패했습니다. 정의를 다시 조회하세요."
          : "값 변환은 완료되었습니다. 최신 입력 항목 조회에 실패했습니다. 상태를 다시 조회하세요.";
      } finally {
        outcome.pending = null;
        if (alive && kind === "job" && outcomes.get(id) === outcome) {
          state = { ...state, jobErrors: { ...state.jobErrors, [id]: outcome.error } };
          emit();
        }
      }
      return outcome.error;
    })();
    return outcome.pending;
  };
  return {
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    snapshot: () => state,
    initialize: (signal: AbortSignal) => {
      alive = true;
      return refresh(signal, false);
    },
    refresh,
    basicSaveInput: () => ({
      expected_schema_version: state.type!.schema_version,
      label: state.label,
      icon_id: state.icon,
      archived: state.archived,
    }),
    editBasic: (...[field, value]: ["label" | "icon", string] | ["archived", boolean]) => {
      state = { ...state, [field]: value };
      emit();
    },
    acceptBasicSave: (saved: EntityType) => {
      admitType(saved, false);
      state = { ...state, latestBasics: null, basicConflict: false };
      emit();
    },
    conflict: (value: boolean) => {
      state = { ...state, basicConflict: value };
      emit();
    },
    cancelBasics: () => {
      state = {
        ...state,
        label: state.type?.label ?? "",
        icon: state.type?.icon_id ?? "box",
        archived: state.type?.archived ?? false,
      };
      emit();
    },
    readLatestBasics: async () => {
      if (!typeId || state.latestBusy) return;
      const controller = new AbortController();
      latestPending?.abort();
      latestPending = controller;
      state = { ...state, latestBusy: true };
      emit();
      try {
        const saved = await api<EntityType>("GET", `/entity-types/${typeId}`, undefined, controller.signal);
        if (!alive || controller.signal.aborted) return;
        const accepted = admitType(saved, true);
        state = { ...state, latestBasics: accepted, basicConflict: false };
        emit();
      } finally {
        if (alive && latestPending === controller) {
          latestPending = null;
          state = { ...state, latestBusy: false };
          emit();
        }
      }
    },
    readHistoryPage: async () => {
      if (!typeId || state.historyBusy || state.historyBefore === null) return;
      const controller = new AbortController();
      const generation = historyGeneration;
      const before = state.historyBefore;
      historyPending = controller;
      state = { ...state, historyBusy: true };
      emit();
      try {
        const page = await api<HistoryPage>(
          "GET",
          `/entity-types/${typeId}/schemas?before=${before}`,
          undefined,
          controller.signal,
        );
        if (!alive || controller.signal.aborted || generation !== historyGeneration) return;
        state = {
          ...state,
          history: [
            ...state.history,
            ...page.items.filter((row) => !state.history.some((item) => item.schema_version === row.schema_version)),
          ],
          historyBefore: page.next_before,
        };
        emit();
      } catch (error) {
        if (!alive || controller.signal.aborted || generation !== historyGeneration) return;
        throw error;
      } finally {
        if (alive && historyPending === controller) {
          historyPending = null;
          state = { ...state, historyBusy: false };
          emit();
        }
      }
    },
    published: async (change?: EntitySchemaChange) => {
      if (change) {
        publishedChange = change.id;
        return publication("change", change.id);
      }
      await refresh();
      const outcome = publishedChange ? changes.get(publishedChange) : undefined;
      if (outcome) {
        outcome.confirmed = true;
        outcome.error = "";
      }
      return "";
    },
    selectJob: (jobId?: string) => {
      if (jobId === selectedJob) return;
      selectedJob = jobId;
      // Each visit observes current definitions once, while repeated polls in that visit deduplicate.
      jobs.clear();
      state = { ...state, jobErrors: {} };
      emit();
    },
    migrationSucceeded: (job: EntitySchemaMigration) => publication("job", job.id),
    dispose: () => {
      alive = false;
      for (const controller of requests) controller.abort();
      latestPending?.abort();
      historyPending?.abort();
    },
  };
}

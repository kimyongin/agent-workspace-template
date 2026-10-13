import type { RecordTemplates } from "@contracts/record-template.ts";
import { createRecordTemplatesDraft } from "./business-settings-drafts.ts";
import { createTagRead } from "../tags/tag-read.ts";
import { api } from "../../lib/api.ts";
import { WriteAttempt } from "../../lib/write-attempt.ts";

/** The two material scopes share a server version, but never share pending edits. */
export function createMaterialTemplateDrafts(typeId?: string) {
  const adapter = createRecordTemplatesDraft(api);
  type Saved = Awaited<ReturnType<typeof adapter.read>>;
  type Scope = "typed" | "common";
  const attempt = new WriteAttempt();
  let before: Saved | null = null;
  let pending: AbortController | null = null;
  let tagAbort: AbortController | null = null;
  let uncertainScope: Scope | null = null;
  const listeners = new Set<() => void>();
  const empty = () => ({
    saved: null as Saved | null,
    draft: {} as RecordTemplates,
    dirty: false,
    busy: false,
    operation: null as "read" | "save" | null,
    error: null as unknown,
    conflict: false,
    latestReady: false,
    uncertain: false,
    locked: false,
  });
  let states = { typed: empty(), common: empty() };
  const group = (value: RecordTemplates, scope: Scope) =>
    scope === "typed" && typeId ? value.entity_types?.[typeId] : value.entity;
  const replace = (
    full: RecordTemplates,
    value: RecordTemplates,
    scope: Scope,
  ): RecordTemplates => {
    const selected = group(value, scope);
    if (scope === "typed" && typeId) {
      const groups = { ...full.entity_types };
      if (selected) groups[typeId] = selected;
      else delete groups[typeId];
      return { ...full, entity_types: groups };
    }
    const result = { ...full };
    if (selected) result.entity = selected;
    else delete result.entity;
    return result;
  };
  const emit = () => {
    for (const scope of ["typed", "common"] as const) {
      const state = states[scope];
      states[scope] = {
        ...state,
        dirty: !!before &&
          JSON.stringify(group(state.draft, scope)) !==
            JSON.stringify(
              group(before.settings.settings.record_templates ?? {}, scope),
            ),
      };
    }
    for (const listener of listeners) listener();
  };
  const publishSaved = (saved: Saved, submitted?: Scope) => {
    before = saved;
    const full = saved.settings.settings.record_templates ?? {};
    for (const scope of ["typed", "common"] as const) {
      const state = states[scope];
      states[scope] = {
        ...state,
        saved,
        draft: state.dirty && submitted !== scope ? replace(full, state.draft, scope) : structuredClone(full),
        conflict: submitted === scope ? false : state.conflict,
        latestReady: submitted ? false : state.conflict,
      };
    }
    emit();
  };
  const read = async (scope: Scope) => {
    if (attempt.snapshot().busy || attempt.snapshot().uncertain) return null;
    pending?.abort();
    for (const key of ["typed", "common"] as const) {
      if (states[key].operation === "read") {
        states[key] = { ...states[key], busy: false };
      }
    }
    const controller = new AbortController();
    pending = controller;
    states[scope] = {
      ...states[scope],
      busy: true,
      operation: "read",
      error: null,
    };
    emit();
    try {
      const saved = await adapter.read(controller.signal);
      if (controller.signal.aborted) return null;
      publishSaved(saved);
      return saved;
    } catch (error) {
      if (!controller.signal.aborted) {
        states[scope] = { ...states[scope], error };
        emit();
      }
      return null;
    } finally {
      if (!controller.signal.aborted) {
        pending = null;
        states[scope] = { ...states[scope], busy: false };
        emit();
      }
    }
  };
  const save = async (scope: Scope) => {
    const state = states[scope];
    if (
      !before || state.busy || state.conflict || !state.dirty ||
      uncertainScope && uncertainScope !== scope || attempt.snapshot().busy
    ) return null;
    const frozenBefore = structuredClone(before);
    const frozenValue = replace(
      structuredClone(before.settings.settings.record_templates ?? {}),
      structuredClone(state.draft),
      scope,
    );
    for (const key of ["typed", "common"] as const) {
      states[key] = { ...states[key], busy: true, operation: "save" };
    }
    states[scope] = { ...states[scope], error: null };
    emit();
    let confirmed: Saved | null = null;
    try {
      await attempt.run(async () => {
        confirmed = await adapter.save(
          frozenValue,
          frozenBefore,
          new AbortController().signal,
          attempt.requestKey(),
        );
        publishSaved(confirmed, scope);
      });
      uncertainScope = null;
      return before;
    } catch (error) {
      uncertainScope = attempt.snapshot().uncertain ? scope : null;
      states[scope] = {
        ...states[scope],
        error,
        conflict: adapter.isConflict(error),
      };
      return null;
    } finally {
      for (const key of ["typed", "common"] as const) {
        states[key] = {
          ...states[key],
          busy: false,
          uncertain: !!uncertainScope,
          locked: !!uncertainScope && uncertainScope !== key,
        };
      }
      emit();
    }
  };
  const resource = (scope: Scope) => ({
    snapshot: () => states[scope],
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    read: () => read(scope),
    save: () => save(scope),
    cancel: () => {},
    dispose: () => {},
    edit: (update: (value: RecordTemplates) => RecordTemplates) => {
      if (!states[scope].busy && !uncertainScope) {
        states[scope] = {
          ...states[scope],
          draft: replace(
            states[scope].draft,
            update(states[scope].draft),
            scope,
          ),
          error: null,
        };
        emit();
      }
    },
    reset: () => {
      const state = states[scope];
      if (
        before && !state.busy && !uncertainScope &&
        (!state.conflict || state.latestReady)
      ) {
        states[scope] = {
          ...state,
          draft: structuredClone(
            before.settings.settings.record_templates ?? {},
          ),
          conflict: false,
          latestReady: false,
          error: null,
        };
        emit();
      }
    },
  });
  return {
    typed: resource("typed"),
    common: resource("common"),
    refreshTags: async () => {
      tagAbort?.abort();
      const controller = new AbortController();
      tagAbort = controller;
      try {
        const tags = await createTagRead(api).all("record", controller.signal);
        if (!controller.signal.aborted && before) {
          before = { ...before, availableTags: tags.map((tag) => tag.id) };
          for (const key of ["typed", "common"] as const) {
            states[key] = {
              ...states[key],
              saved: before,
            };
          }
          emit();
        }
      } catch {
        /* The picker reports dictionary read failures; retain the last checked dictionary. */
      }
    },
    dispose: () => {
      pending?.abort();
      tagAbort?.abort();
      attempt.abandon();
    },
  };
}
export type MaterialTemplateResource = ReturnType<
  typeof createMaterialTemplateDrafts
>["typed"];

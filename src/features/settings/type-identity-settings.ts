import type { EntityTypeIdentity } from "@contracts/entity-issuer.ts";
import { ApiError } from "../../lib/api-error.ts";
import type { SettingsDraftAdapter } from "./settings-draft.ts";
export type TypeIdentityDraft = Pick<EntityTypeIdentity, "label" | "default_source"> & {
  sources: { code: string; rule_id: string; active: boolean }[];
};
export interface TypeIdentitySettingsPort {
  read: (typeId: string, signal: AbortSignal) => Promise<EntityTypeIdentity>;
  save: (
    typeId: string,
    input: TypeIdentityDraft & { expected_version: number },
    signal: AbortSignal,
    key: string,
  ) => Promise<EntityTypeIdentity>;
}
export function typeIdentitySettingsAdapter(
  typeId: string,
  port: TypeIdentitySettingsPort,
): SettingsDraftAdapter<TypeIdentityDraft, EntityTypeIdentity> {
  return {
    version: (saved) => saved.version,
    initial: { label: "", default_source: "app", sources: [] },
    read: (signal) => port.read(typeId, signal),
    save: (draft, before, signal, key) =>
      port.save(typeId, { ...draft, expected_version: before.version }, signal, key),
    toDraft: (saved) => ({
      label: saved.label,
      default_source: saved.default_source,
      sources: saved.sources.map(({ code, rule_id, active }) => ({ code, rule_id, active })),
    }),
    isConflict: (error) => error instanceof ApiError && ["settings_changed", "conflict"].includes(error.code),
  };
}

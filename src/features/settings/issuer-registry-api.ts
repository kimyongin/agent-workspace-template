import { useMemo } from "react";
import { useApi } from "../../lib/api-context.tsx";
import type { EntityIssuer, EntityTypeIdentity, IdentifierRule } from "@contracts/entity-issuer.ts";
import type { ApiRequest } from "../../lib/api.ts";
import type { TypeIdentitySettingsPort } from "./type-identity-settings.ts";
export const createTypeIdentityPort = (api: ApiRequest): TypeIdentitySettingsPort => ({
  read: (id, signal) => api("GET", `/entity-types/${encodeURIComponent(id)}/identity`, undefined, signal),
  save: (id, input, signal, key) =>
    api("PATCH", `/entity-types/${encodeURIComponent(id)}/identity`, input, signal, key),
});
export const createIssuerRegistry = (api: ApiRequest) => ({
  remove: (code: string, version: number, key: string) =>
    api<{ deleted: true }>(
      "DELETE",
      `/entity-issuers/${encodeURIComponent(code)}`,
      { expected_version: version },
      undefined,
      key,
    ),
  removeRule: (id: string, version: number, key: string) =>
    api<{ deleted: true }>(
      "DELETE",
      `/entity-identifier-rules/${encodeURIComponent(id)}`,
      { expected_version: version },
      undefined,
      key,
    ),
  list: (signal?: AbortSignal) => api<{ items: EntityIssuer[] }>("GET", "/entity-issuers", undefined, signal),
  rules: (code: string, signal?: AbortSignal) =>
    api<{ items: IdentifierRule[] }>("GET", `/entity-issuers/${encodeURIComponent(code)}/rules`, undefined, signal),
  create: (input: { code: string; label: string }, key: string) =>
    api<EntityIssuer>("POST", "/entity-issuers", input, undefined, key),
  update: (code: string, input: { label: string; active: boolean; expected_version: number }, key: string) =>
    api<EntityIssuer>("PATCH", `/entity-issuers/${encodeURIComponent(code)}`, input, undefined, key),
  createRule: (source: string, input: { label: string; meaning: string }, key: string) =>
    api<IdentifierRule>("POST", `/entity-issuers/${encodeURIComponent(source)}/rules`, input, undefined, key),
  updateRule: (id: string, input: { label: string; active: boolean; expected_version: number }, key: string) =>
    api<IdentifierRule>("PATCH", `/entity-identifier-rules/${encodeURIComponent(id)}`, input, undefined, key),
});

export function useIssuerRegistry() { const api = useApi(); return useMemo(() => createIssuerRegistry(api), [api]); }
export function useTypeIdentityPort() { const api = useApi(); return useMemo(() => createTypeIdentityPort(api), [api]); }

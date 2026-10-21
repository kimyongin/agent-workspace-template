import { useEffect, useState } from "react";
import type { EntityIssuer, IdentifierKindMetadata, IdentifierRule } from "@contracts/entity-issuer.ts";
import { useIssuerRegistry } from "./issuer-registry-api.ts";
import { writeErrorMessage } from "../../lib/write-attempt.ts";
/** Full registry access is used only inside the settings-authorized schema editor. */
export function useIdentifierCatalog(enabled: boolean) {
  const registry = useIssuerRegistry();
  const [revision, setRevision] = useState(0),
    [state, setState] = useState<
      { issuers: EntityIssuer[]; kinds: IdentifierKindMetadata[]; loading: boolean; error: string }
    >({ issuers: [], kinds: [], loading: false, error: "" });
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    setState((previous) => ({ ...previous, loading: true, error: "" }));
    void registry.list(controller.signal).then(async (result) => {
      const entries = await Promise.all(
        result.items.map(async (issuer) =>
          (await registry.rules(issuer.code, controller.signal)).items.map((rule) => ({
            ...rule,
            source_label: issuer.label,
            active: issuer.active && rule.active,
            source_version: issuer.version,
          }))
        ),
      );
      if (!controller.signal.aborted) {
        setState({ issuers: result.items, kinds: entries.flat(), loading: false, error: "" });
      }
    }).catch((error) => {
      if (!controller.signal.aborted) {
        setState((previous) => ({ ...previous, loading: false, error: writeErrorMessage(error) }));
      }
    });
    return () => controller.abort();
  }, [registry, enabled, revision]);
  return {
    ...state,
    admitIssuer: (issuer: EntityIssuer) =>
      setState((previous) => ({
        ...previous,
        issuers: [...previous.issuers.filter((row) => row.code !== issuer.code), issuer],
      })),
    admitRule: (rule: IdentifierRule) =>
      setState((previous) => {
        const issuer = previous.issuers.find((row) => row.code === rule.source);
        return issuer
          ? {
            ...previous,
            kinds: [...previous.kinds.filter((row) => row.id !== rule.id), {
              ...rule,
              source_label: issuer.label,
              source_version: issuer.version,
              active: rule.active && issuer.active,
            }],
          }
          : previous;
      }),
    reload: () => setRevision((value) => value + 1),
  };
}

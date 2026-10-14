import type { EntityTypeIdentity } from "../functions/_shared/contracts/entity-issuer.ts";
export function identityFixture(type_id: string): EntityTypeIdentity {
  return {
    type_id,
    label: "번호",
    version: 1,
    default_source: "app",
    sources: [{
      code: "app",
      rule_id: "00000000-0000-4000-8000-000000000001",
      active: true,
      source_label: "앱",
      rule_label: "자동 발급",
      generation: "automatic",
    }],
  };
}

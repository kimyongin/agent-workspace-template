export function identifierKindsFixture(): import("../functions/_shared/contracts/entity-issuer.ts").IdentifierKindMetadata[] {
  return [{
    id: "00000000-0000-4000-8000-000000000001",
    source: "app",
    label: "자동 발급",
    source_label: "앱",
    active: true,
    generation: "automatic",
    version: 1,
    source_version: 1,
  }];
}
